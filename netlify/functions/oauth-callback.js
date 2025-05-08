// netlify/functions/oauth-callback.js
import crypto from 'crypto';
import axios from 'axios';

// Your app's credentials (set in Netlify environment variables)
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;

// In production, use a database to store tokens
const tokens = {};

export const handler = async function(event, context) {
  const queryParams = event.queryStringParameters || {};
  const { code, shop, state } = queryParams;
  
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
    
    // Store the token (in a database in production)
    tokens[shop] = access_token;
    
    console.log(`Token obtained for ${shop}: ${access_token}`);
    
    // Redirect back to the app in the Shopify admin
    return {
      statusCode: 302,
      headers: {
        'Location': `https://${shop}/admin/apps`
      },
      body: ''
    };
  } catch (error) {
    console.error('Error exchanging code for token:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to complete OAuth' })
    };
  }
};