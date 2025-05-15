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
    
    // Process line items to ensure proper product linking
    if (draft_order.line_items && Array.isArray(draft_order.line_items)) {
      console.log(`Processing ${draft_order.line_items.length} line items`);
      
      for (let i = 0; i < draft_order.line_items.length; i++) {
        const item = draft_order.line_items[i];
        
        // Ensure price is formatted as a string with 2 decimal places
        if (item.price && typeof item.price !== 'string') {
          item.price = item.price.toFixed(2);
        }
        
        // Ensure product_id and variant_id are properly formatted as numbers
        if (item.product_id) {
          if (typeof item.product_id === 'string') {
            // Check if it's a Shopify GraphQL ID format (gid://shopify/Product/123456789)
            if (item.product_id.includes('gid://')) {
              item.product_id = parseInt(item.product_id.split('/').pop(), 10);
            } else {
              item.product_id = parseInt(item.product_id, 10);
            }
          }
          console.log(`Line item ${i + 1} product_id processed: ${item.product_id}`);
        }
        
        if (item.variant_id) {
          if (typeof item.variant_id === 'string') {
            // Check if it's a Shopify GraphQL ID format (gid://shopify/ProductVariant/123456789)
            if (item.variant_id.includes('gid://')) {
              item.variant_id = parseInt(item.variant_id.split('/').pop(), 10);
            } else {
              item.variant_id = parseInt(item.variant_id, 10);
            }
          }
          console.log(`Line item ${i + 1} variant_id processed: ${item.variant_id}`);
        }
        
        // Log the full line item details for debugging
        console.log(`Line item ${i + 1} details:`, {
          title: item.title,
          product_id: item.product_id || 'None',
          variant_id: item.variant_id || 'None',
          price: item.price,
          quantity: item.quantity,
          sku: item.sku || 'None',
          properties: item.properties || 'None'
        });
      }
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
    // This keeps the format sent from form-handler.js
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
    
    // Create an enhanced response that includes the reservation number at the top level
    const enhancedDraftOrder = {
      ...response.data.draft_order,
      // Add the reservation_number field directly in the draft order for easier access
      reservation_number: reservationNumber
    };
    
    // Log the final response with reservation number
    console.log("Final response data:", {
      reservation_number: reservationNumber,
      draft_order: { id: draftOrderId }
    });
      
    // Return successful response with reservation number at multiple levels for redundancy
    return {
      statusCode: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: true,
        reservation_number: reservationNumber, // Top level
        draft_order: enhancedDraftOrder,       // Inside draft_order too
        admin_url: adminUrl
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