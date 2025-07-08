import crypto from 'crypto';
import axios from 'axios';

const SHOP_DOMAIN = process.env.SHOP_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-01';  // Default fallback
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;

// CORS headers for all responses
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

export const handler = async function(event, context) {
  // Handle preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }

  try {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }
    
    // Parse request body
    const requestBody = JSON.parse(event.body || '{}');
    const { draft_order, recaptcha_token, recaptcha_action } = requestBody;

    if (!draft_order) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing draft order data' })
      };
    }
    
    // Verify reCAPTCHA v3 token if provided
    if (RECAPTCHA_SECRET_KEY) {
      if (!recaptcha_token) {
        return {
          statusCode: 400,
          headers: corsHeaders,
          body: JSON.stringify({ error: 'reCAPTCHA verification failed: No token provided' })
        };
      }
      
      try {
        // Verify with Google reCAPTCHA API
        const recaptchaVerifyUrl = 'https://www.google.com/recaptcha/api/siteverify';
        const recaptchaResponse = await axios.post(
          recaptchaVerifyUrl,
          null,
          {
            params: {
              secret: RECAPTCHA_SECRET_KEY,
              response: recaptcha_token
            },
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
            }
          }
        );
        
        console.log('reCAPTCHA v3 verification response:', JSON.stringify(recaptchaResponse.data));
        
        // Check if verification was successful
        if (!recaptchaResponse.data.success) {
          console.error('reCAPTCHA verification failed:', recaptchaResponse.data['error-codes']);
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ 
              error: 'reCAPTCHA verification failed',
              details: recaptchaResponse.data['error-codes']
            })
          };
        }
        
        // For reCAPTCHA v3, always check the score
        const score = recaptchaResponse.data.score;
        console.log('reCAPTCHA v3 score:', score);
        console.log('reCAPTCHA v3 action:', recaptcha_action);
        console.log('reCAPTCHA v3 hostname:', recaptchaResponse.data.hostname);
        
        // Verify the action matches what we expect
        if (recaptcha_action && recaptchaResponse.data.action !== recaptcha_action) {
          console.error('reCAPTCHA action mismatch:', {
            expected: recaptcha_action,
            received: recaptchaResponse.data.action
          });
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ 
              error: 'reCAPTCHA verification failed: Action mismatch'
            })
          };
        }
        
        // Reject if score is too low (0.7 is likely human)
        const minScore = 0.7;
        if (score < minScore) {
          console.error(`reCAPTCHA score too low: ${score} (minimum: ${minScore})`);
          return {
            statusCode: 400,
            headers: corsHeaders,
            body: JSON.stringify({ 
              error: 'Security verification failed. Please try again.',
              score: score,
              threshold: minScore
            })
          };
        }
        
        // Log successful verification with score
        console.log(`reCAPTCHA v3 verification successful with score: ${score}`);
      } catch (recaptchaError) {
        console.error('Error verifying reCAPTCHA token:', recaptchaError);
        return {
          statusCode: 500,
          headers: corsHeaders,
          body: JSON.stringify({ 
            error: 'Error verifying reCAPTCHA token',
            details: recaptchaError.message
          })
        };
      }
    } else {
      console.warn('RECAPTCHA_SECRET_KEY not configured, skipping reCAPTCHA verification');
    }
    
    // Extract and validate query parameters
    const queryParams = event.queryStringParameters || {};
    const { signature, timestamp } = queryParams;
    if (!signature || !timestamp) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing required query parameters' })
      };
    }
    
    // Verify the request is coming from Shopify
    const verificationResult = verifyShopifySignature(queryParams);
    if (!verificationResult.valid) {
      console.log("Verification failed:", verificationResult.method);
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }
    
    // Check for access token
    if (!ACCESS_TOKEN) {
      console.error("Missing SHOPIFY_ACCESS_TOKEN environment variable");
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Server configuration error - missing access token' })
      };
    }
    
    // Get product ID from line items if available
    let productId = null;
    let productTitle = "Reserved Product";
    let productHandle = "";
    let stockingNumber = "";
    
    // Process line items to ensure proper product linking
    if (draft_order.line_items && Array.isArray(draft_order.line_items)) {
      console.log(`Processing ${draft_order.line_items.length} line items`);
      
      for (let i = 0; i < draft_order.line_items.length; i++) {
        const item = draft_order.line_items[i];
        
        // Extract product title for email
        if (item.title) {
          productTitle = item.title.replace(/^R[A-Z0-9]+\s*-\s*/, '').trim();
          console.log(`Product title cleaned: "${productTitle}" (from: "${item.title}")`);
        }
        
        // Extract stocking number from properties if available
        if (item.properties && Array.isArray(item.properties)) {
          const stockingProp = item.properties.find(p => p.name === "Stocking Number");
          if (stockingProp && stockingProp.value) {
            stockingNumber = stockingProp.value;
          }
        }
        
        // Look up product ID using variant_id (this is the main purpose)
        if (item.variant_id) {
          try {
            console.log(`Looking up product ID for variant ${item.variant_id}...`);
            const variantResponse = await axios.get(
              `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/variants/${item.variant_id}.json`,
              {
                headers: {
                  'X-Shopify-Access-Token': ACCESS_TOKEN
                }
              }
            );

            console.log(`Variant response for ${item.variant_id}:`, variantResponse.data);
            
            if (variantResponse.data.variant && variantResponse.data.variant.product_id) {
              const foundProductId = variantResponse.data.variant.product_id;
              console.log(`Found product ID: ${foundProductId} for variant ${item.variant_id}`);
              
              // Store the product ID for metafield updates
              productId = foundProductId;
              
              // Also add it to the line item for proper linking in Shopify admin
              item.product_id = foundProductId;
            } else {
              console.log("Variant found but no product_id in the response");
            }
          } catch (error) {
            console.error(`Error looking up product for variant ${item.variant_id}:`, error.message);
            if (error.response) {
              console.error("Response data:", JSON.stringify(error.response.data));
            }
          }
        }
        
        // Log the updated line item details
        console.log(`Line item ${i + 1} details after processing:`, {
          title: item.title,
          product_id: item.product_id || 'None',
          variant_id: item.variant_id || 'None',
          price: item.price,
          quantity: item.quantity
        });
      }
    }

    // After processing, log the product ID status
    if (productId) {
      console.log(`Will update metafields for product ID: ${productId}`);
    } else {
      console.log("WARNING: No product ID found. Metafields cannot be updated!");
    }
    
    // Generate a Reservation number
    function generateReservationNumber() {
      // Current date components for the reservation prefix
      const now = new Date();
      const year = now.getFullYear().toString().substr(2, 2); // Last two digits of year
      const month = (now.getMonth() + 1).toString().padStart(2, '0'); // Month (1-12), zero-padded
      const day = now.getDate().toString().padStart(2, '0'); // Day of month, zero-padded
      
      // Random suffix (4 digits)
      const randomSuffix = Math.floor(1000 + Math.random() * 9000);
      
      // Combine to create Reservation number: RES-YYMMDD-XXXX
      return `RES-${year}${month}${day}-${randomSuffix}`;
    }
    
    // Add Reservation number to the draft order
    const reservationNumber = generateReservationNumber();
    console.log(`Generated Reservation number: ${reservationNumber}`);
    
    // Extract customer information from the draft order
    const customerEmail = draft_order.customer && draft_order.customer.email 
      ? draft_order.customer.email
      : '[No email provided]';
    
    // Parse the note to extract customer information for metafields
    let practiceName = '';
    let zipCode = '';
    let role = '';
    
    if (draft_order.note) {
      const practiceNameMatch = draft_order.note.match(/Practice Name: ([^\n]+)/);
      if (practiceNameMatch && practiceNameMatch[1]) {
        practiceName = practiceNameMatch[1].trim();
      }
      
      const zipCodeMatch = draft_order.note.match(/ZIP\/Postal Code: ([^\n]+)/);
      if (zipCodeMatch && zipCodeMatch[1]) {
        zipCode = zipCodeMatch[1].trim();
      }
      
      const roleMatch = draft_order.note.match(/Role: ([^\n]+)/);
      if (roleMatch && roleMatch[1]) {
        role = roleMatch[1].trim();
      }
    }
    
    // Prepend the reservation number to the note
    if (draft_order.note) {
      draft_order.note = `Reservation Number: ${reservationNumber}\n\n${draft_order.note}`;
    } else {
      draft_order.note = `Reservation Number: ${reservationNumber}`;
    }
    
    // Add Reservation number to tags for easy filtering
    if (draft_order.tags) {
      draft_order.tags = `${reservationNumber}, ${draft_order.tags}`;
    } else {
      draft_order.tags = reservationNumber;
    }
    
    // Log the sanitized draft order (redacting sensitive info)
    const sanitizedDraftOrder = JSON.parse(JSON.stringify(draft_order));
    if (sanitizedDraftOrder.customer && sanitizedDraftOrder.customer.email) {
      sanitizedDraftOrder.customer.email = sanitizedDraftOrder.customer.email.replace(/(.{2})(.*)(@.*)/, '$1***$3');
    }
    console.log("Creating draft order:", JSON.stringify(sanitizedDraftOrder, null, 2));
    
    // Make API call to create draft order
    const response = await axios.post(
      `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/draft_orders.json`,
      { draft_order },
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      }
    );
    
    // Get the draft order details from the response
    const draftOrderId = response.data.draft_order.id;
    const adminUrl = `https://${SHOP_DOMAIN}/admin/draft_orders/${draftOrderId}`;
    
    // Set reserved metafield if we have a product ID
    let metafieldResult = null;

    // Set product as reserved using metafields only
    if (productId) {
      try {
        console.log(`Setting product ${productId} as reserved using metafields...`);
        
        // First ensure the product exists 
        const productResponse = await axios.get(
          `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/products/${productId}.json`,
          {
            headers: {
              'X-Shopify-Access-Token': ACCESS_TOKEN
            }
          }
        );
        
        const product = productResponse.data.product;
        console.log(`Product: "${product.title}" (ID: ${productId})`);
        
        // Check for existing metafields
        const metafieldsResponse = await axios.get(
          `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/products/${productId}/metafields.json`,
          {
            headers: {
              'X-Shopify-Access-Token': ACCESS_TOKEN
            }
          }
        );
        
        const existingMetafields = metafieldsResponse.data.metafields;
        console.log(`Found ${existingMetafields.length} existing metafields`);
        
        // Functions for updating existing metafields
        async function updateMetafield(metafieldId, value, type = 'single_line_text_field') {
          console.log(`Updating metafield ${metafieldId} with value ${value}`);
          
          return axios.put(
            `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/metafields/${metafieldId}.json`,
            {
              metafield: {
                id: metafieldId,
                value: value,
                type: type
              }
            },
            {
              headers: {
                'X-Shopify-Access-Token': ACCESS_TOKEN,
                'Content-Type': 'application/json'
              }
            }
          );
        }
        
        async function createMetafield(namespace, key, value, type = 'single_line_text_field') {
          console.log(`Creating metafield ${namespace}.${key} with value ${value}`);
          
          return axios.post(
            `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/products/${productId}/metafields.json`,
            {
              metafield: {
                namespace: namespace,
                key: key,
                value: value,
                type: type
              }
            },
            {
              headers: {
                'X-Shopify-Access-Token': ACCESS_TOKEN,
                'Content-Type': 'application/json'
              }
            }
          );
        }
        
        // 1. Set the availability_status metafield to "Reserved"
        const availabilityStatusMetafield = existingMetafields.find(
          m => m.namespace === 'custom' && m.key === 'availability_status'
        );
        
        if (availabilityStatusMetafield) {
          await updateMetafield(availabilityStatusMetafield.id, 'Reserved');
        } else {
          await createMetafield('custom', 'availability_status', 'Reserved');
        }
        
        // 2. Set the reservation_number metafield
        const reservationNumberMetafield = existingMetafields.find(
          m => m.namespace === 'custom' && m.key === 'reservation_number'
        );
        
        if (reservationNumberMetafield) {
          await updateMetafield(reservationNumberMetafield.id, reservationNumber);
        } else {
          await createMetafield('custom', 'reservation_number', reservationNumber);
        }
        
        // 3. Verify the metafields were set
        const verifyResponse = await axios.get(
          `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/products/${productId}/metafields.json`,
          {
            headers: {
              'X-Shopify-Access-Token': ACCESS_TOKEN
            }
          }
        );
        
        const updatedMetafields = verifyResponse.data.metafields;
        
        const updatedAvailabilityStatusMetafield = updatedMetafields.find(
          m => m.namespace === 'custom' && m.key === 'availability_status'
        );
        
        const updatedReservationNumberMetafield = updatedMetafields.find(
          m => m.namespace === 'custom' && m.key === 'reservation_number'
        );
        
        console.log("VERIFICATION:");
        console.log(`- availability_status metafield: ${updatedAvailabilityStatusMetafield ? 'Found (' + updatedAvailabilityStatusMetafield.value + ')' : 'Not found'}`);
        console.log(`- reservation_number metafield: ${updatedReservationNumberMetafield ? 'Found (' + updatedReservationNumberMetafield.value + ')' : 'Not found'}`);
        
        console.log(`Product successfully marked as reserved using metafields`);
        
        metafieldResult = {
          availability_status: updatedAvailabilityStatusMetafield ? updatedAvailabilityStatusMetafield.value : null,
          reservation_number: reservationNumber
        };
      } catch (error) {
        console.error(`Error setting product as reserved:`, error);
        metafieldResult = {
          error: error.message
        };
      }
    }
    
    // ===== ADD DRAFT ORDER METAFIELDS =====
    let draftOrderMetafieldsResult = null;
    
    try {
      console.log(`Adding metafields to draft order ${draftOrderId}...`);
      
      // Create metafields for the draft order to make data easily accessible in emails
      const draftOrderMetafields = [
        {
          namespace: 'reservation',
          key: 'reservation_number',
          value: reservationNumber,
          type: 'single_line_text_field'
        },
        {
          namespace: 'reservation',
          key: 'stocking_number',
          value: stockingNumber || productHandle || '',
          type: 'single_line_text_field'
        },
        {
          namespace: 'reservation',
          key: 'practice_name',
          value: practiceName,
          type: 'single_line_text_field'
        },
        {
          namespace: 'reservation',
          key: 'customer_email',
          value: customerEmail,
          type: 'single_line_text_field'
        },
        {
          namespace: 'reservation',
          key: 'customer_zip_code',
          value: zipCode,
          type: 'single_line_text_field'
        },
        {
          namespace: 'reservation',
          key: 'customer_role',
          value: role,
          type: 'single_line_text_field'
        },
        {
          namespace: 'reservation',
          key: 'product_title',
          value: productTitle,
          type: 'single_line_text_field'
        },
        {
          namespace: 'reservation',
          key: 'reservation_date',
          value: new Date().toLocaleDateString(),
          type: 'single_line_text_field'
        },
        {
          namespace: 'reservation',
          key: 'hold_duration',
          value: '2 business days',
          type: 'single_line_text_field'
        }
      ];
      
      // Add each metafield to the draft order
      const metafieldResults = [];
      for (const metafield of draftOrderMetafields) {
        try {
          const metafieldResponse = await axios.post(
            `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/draft_orders/${draftOrderId}/metafields.json`,
            { metafield },
            {
              headers: {
                'X-Shopify-Access-Token': ACCESS_TOKEN,
                'Content-Type': 'application/json'
              }
            }
          );
          
          console.log(`✅ Created draft order metafield: ${metafield.namespace}.${metafield.key} = ${metafield.value}`);
          metafieldResults.push({
            key: `${metafield.namespace}.${metafield.key}`,
            value: metafield.value,
            success: true
          });
        } catch (metafieldError) {
          console.error(`❌ Error creating draft order metafield ${metafield.namespace}.${metafield.key}:`, metafieldError.message);
          metafieldResults.push({
            key: `${metafield.namespace}.${metafield.key}`,
            value: metafield.value,
            success: false,
            error: metafieldError.message
          });
        }
      }
      
      draftOrderMetafieldsResult = {
        total_attempted: draftOrderMetafields.length,
        successful: metafieldResults.filter(r => r.success).length,
        failed: metafieldResults.filter(r => !r.success).length,
        details: metafieldResults
      };
      
      console.log(`Draft order metafields summary: ${draftOrderMetafieldsResult.successful}/${draftOrderMetafieldsResult.total_attempted} successful`);
      
    } catch (error) {
      console.error("Error adding draft order metafields:", error);
      draftOrderMetafieldsResult = {
        error: error.message
      };
    }
    
    // Create an enhanced response
    const enhancedDraftOrder = {
      ...response.data.draft_order
    };
    
    // Log the final response with reservation number
    console.log("Final response data:", {
      reservation_number: reservationNumber,
      draft_order: { id: draftOrderId },
      metafields_added: draftOrderMetafieldsResult ? draftOrderMetafieldsResult.successful : 0
    });
      
    // Return successful response with enhanced debugging information
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        reservation_number: reservationNumber,
        draft_order: {
          id: draftOrderId,
          name: enhancedDraftOrder.name || "Draft Order",
          admin_url: adminUrl
        },
        product_status_updated: metafieldResult ? true : false,
        product_id: productId || 'Not found',
        metafield_result: metafieldResult || {
          error: "Metafield update was not attempted",
          reason: productId ? "Unknown error" : "No product ID found"
        },
        draft_order_metafields: draftOrderMetafieldsResult,
        debug_info: {
          timestamp: new Date().toISOString(),
          line_items_count: draft_order.line_items ? draft_order.line_items.length : 0,
          product_id_found: !!productId,
          metafields_updated: metafieldResult && !metafieldResult.error,
          draft_order_metafields_added: draftOrderMetafieldsResult ? draftOrderMetafieldsResult.successful : 0,
          recaptcha_verified: true
        }
      })
    };
  } catch (error) {
    console.error("Error creating draft order:", error);
    
    // Handle specific 401 errors
    if (error.response && error.response.status === 401) {
      return {
        statusCode: 401,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: "Access token expired or invalid"
        })
      };
    }
    
    // Handle Shopify API errors more specifically
    if (error.response && error.response.data && error.response.data.errors) {
      return {
        statusCode: error.response.status || 400,
        headers: corsHeaders,
        body: JSON.stringify({
          success: false,
          error: error.response.data.errors
        })
      };
    }
    
    // Generic error response
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({
        success: false,
        error: error.message || "Server error"
      })
    };
  }
};

/**
 * Verifies if a request is coming from Shopify based on the signature
 */
function verifyShopifySignature(query) {
  const { signature, ...params } = query;
  
  if (!signature || !SHOPIFY_API_SECRET) {
    return { valid: false, method: 'Missing signature or API secret' };
  }
  
  // Try different signature methods - we know Method 4 works from previous logs
  try {
    // Method 4: All params sorted, no separator (the one that worked previously)
    const signatureString = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('');
    
    const calculatedSignature = crypto
      .createHmac('sha256', SHOPIFY_API_SECRET)
      .update(signatureString)
      .digest('hex');
    
    if (signature === calculatedSignature) {
      return { valid: true, method: 'Method 4: All params sorted, no separator' };
    }
    
    // Fallback to other methods if the primary one doesn't work
    const methods = [
      // Method 1: shop & timestamp with & separator
      { 
        string: `shop=${params.shop || SHOP_DOMAIN}&timestamp=${params.timestamp}`,
        label: 'Method 1: shop & timestamp with & separator'
      },
      // Method 2: shop & timestamp with no separator
      {
        string: `shop=${params.shop || SHOP_DOMAIN}timestamp=${params.timestamp}`,
        label: 'Method 2: shop & timestamp with no separator'
      },
      // Method 3: All params sorted with & separator
      {
        string: Object.keys(params).sort().map(key => `${key}=${params[key]}`).join('&'),
        label: 'Method 3: All params sorted with & separator'
      },
      // Method 5: All params unsorted with & separator
      {
        string: Object.keys(params).map(key => `${key}=${params[key]}`).join('&'),
        label: 'Method 5: All params unsorted with & separator'
      },
      // Method 6: All params unsorted with no separator
      {
        string: Object.keys(params).map(key => `${key}=${params[key]}`).join(''),
        label: 'Method 6: All params unsorted with no separator'
      }
    ];
    
    for (const method of methods) {
      const methodSignature = crypto
        .createHmac('sha256', SHOPIFY_API_SECRET)
        .update(method.string)
        .digest('hex');
      
      if (signature === methodSignature) {
        return { valid: true, method: method.label };
      }
    }
    
    return { valid: false, method: 'All signature methods failed' };
  } catch (error) {
    return { valid: false, method: `Verification error: ${error.message}` };
  }
}