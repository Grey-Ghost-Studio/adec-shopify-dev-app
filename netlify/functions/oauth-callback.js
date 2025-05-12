import axios from 'axios';

// App credentials and configuration
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const SHOP_DOMAIN = process.env.SHOP_DOMAIN;

export const handler = async function(event, context) {
  const { code, shop } = event.queryStringParameters || {};
  
  // Validate required parameters
  if (!code || !shop) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing required parameters' })
    };
  }

  try {
    // Exchange the code for an access token
    const tokenResponse = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: SHOPIFY_API_KEY,
      client_secret: SHOPIFY_API_SECRET,
      code
    });
    
    const { access_token } = tokenResponse.data;
    
    // Log the token in an easy-to-find format
    console.log('\n' + '='.repeat(60));
    console.log('COPY THIS ACCESS TOKEN TO YOUR NETLIFY ENVIRONMENT VARIABLES');
    console.log(`ACCESS TOKEN: ${access_token}`);
    console.log('='.repeat(60) + '\n');
    
    // Redirect back to the app in the Shopify admin
    return {
      statusCode: 302,
      headers: {
        'Location': `https://${shop}/admin/apps`
      },
      body: ''
    };
  } catch (error) {
    console.error('OAuth error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        error: 'Failed to complete OAuth process',
        details: error.message
      })
    };
  }
};