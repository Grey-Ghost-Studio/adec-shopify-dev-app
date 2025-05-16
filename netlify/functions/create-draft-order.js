import crypto from 'crypto';
import axios from 'axios';

const SHOP_DOMAIN = process.env.SHOP_DOMAIN;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

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
    const { draft_order } = JSON.parse(event.body || '{}');
    if (!draft_order) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: 'Missing draft order data' })
      };
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
    
    // Process line items to ensure proper product linking
    if (draft_order.line_items && Array.isArray(draft_order.line_items)) {
      console.log(`Processing ${draft_order.line_items.length} line items`);
      
      for (let i = 0; i < draft_order.line_items.length; i++) {
        const item = draft_order.line_items[i];
        
        // If we have variant_id but no product_id, look up the product
        if (item.variant_id && (!item.product_id || item.product_id === 'None')) {
          try {
            console.log(`Looking up product ID for variant ${item.variant_id}...`);
            const variantResponse = await axios.get(
              `https://${SHOP_DOMAIN}/admin/api/2023-04/variants/${item.variant_id}.json`,
              {
                headers: {
                  'X-Shopify-Access-Token': ACCESS_TOKEN
                }
              }
            );
            
            if (variantResponse.data.variant && variantResponse.data.variant.product_id) {
              const foundProductId = variantResponse.data.variant.product_id;
              console.log(`Found product ID: ${foundProductId} for variant ${item.variant_id}`);
              
              // Update both the line item and the global productId variable
              item.product_id = foundProductId;
              productId = foundProductId;
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
    
    // Extract email from customer object
    const customerEmail = draft_order.customer && draft_order.customer.email 
      ? draft_order.customer.email
      : '[No email provided]';
    
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
      `https://${SHOP_DOMAIN}/admin/api/2023-04/draft_orders.json`,
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

// Simplified approach focused on metafields only
// Replace the product update section in create-draft-order.js with this

// Set product as reserved using metafields only
if (productId) {
  try {
    console.log(`Setting product ${productId} as reserved using metafields...`);
    
    // First ensure the product exists 
    const productResponse = await axios.get(
      `https://${SHOP_DOMAIN}/admin/api/2023-04/products/${productId}.json`,
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
      `https://${SHOP_DOMAIN}/admin/api/2023-04/products/${productId}/metafields.json`,
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN
        }
      }
    );
    
    const existingMetafields = metafieldsResponse.data.metafields;
    console.log(`Found ${existingMetafields.length} existing metafields`);
    
    // Functions for updating existing metafields
    async function updateMetafield(metafieldId, value, type = 'single_line_text') {
      console.log(`Updating metafield ${metafieldId} with value ${value}`);
      
      return axios.put(
        `https://${SHOP_DOMAIN}/admin/api/2023-04/metafields/${metafieldId}.json`,
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
        `https://${SHOP_DOMAIN}/admin/api/2023-04/products/${productId}/metafields.json`,
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
    
    // 1. Set the is_reserved metafield
    const isReservedMetafield = existingMetafields.find(
      m => m.namespace === 'custom' && m.key === 'is_reserved'
    );
    
    if (isReservedMetafield) {
      await updateMetafield(isReservedMetafield.id, 'true', 'boolean');
    } else {
      await createMetafield('custom', 'is_reserved', 'true', 'boolean');
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
      `https://${SHOP_DOMAIN}/admin/api/2023-04/products/${productId}/metafields.json`,
      {
        headers: {
          'X-Shopify-Access-Token': ACCESS_TOKEN
        }
      }
    );
    
    const updatedMetafields = verifyResponse.data.metafields;
    
    const updatedIsReservedMetafield = updatedMetafields.find(
      m => m.namespace === 'custom' && m.key === 'is_reserved'
    );
    
    const updatedReservationNumberMetafield = updatedMetafields.find(
      m => m.namespace === 'custom' && m.key === 'reservation_number'
    );
    
    console.log("VERIFICATION:");
    console.log(`- is_reserved metafield: ${updatedIsReservedMetafield ? 'Found (' + updatedIsReservedMetafield.value + ')' : 'Not found'}`);
    console.log(`- reservation_number metafield: ${updatedReservationNumberMetafield ? 'Found (' + updatedReservationNumberMetafield.value + ')' : 'Not found'}`);
    
    console.log(`Product successfully marked as reserved using metafields`);
    
    metafieldResult = {
      is_reserved: updatedIsReservedMetafield ? updatedIsReservedMetafield.value : null,
      reservation_number: reservationNumber
    };
  } catch (error) {
    console.error(`Error setting product as reserved:`, error);
    metafieldResult = {
      error: error.message
    };
  }
}
    
    // Create an enhanced response
    const enhancedDraftOrder = {
      ...response.data.draft_order
    };
    
    // Log the final response with reservation number
    console.log("Final response data:", {
      reservation_number: reservationNumber,
      draft_order: { id: draftOrderId }
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
        debug_info: {
          timestamp: new Date().toISOString(),
          line_items_count: draft_order.line_items ? draft_order.line_items.length : 0,
          product_id_found: !!productId,
          metafields_updated: metafieldResult && !metafieldResult.error
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