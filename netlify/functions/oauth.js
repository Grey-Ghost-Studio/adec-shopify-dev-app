// netlify/functions/oauth.js
import crypto from 'crypto';
import axios from 'axios';

// Your app's credentials (set in Netlify environment variables)
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY;
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI; // e.g., https://adec-shopify-dev-app.netlify.app/.netlify/functions/oauth-callback

// Local memory for tokens (use a database in production)
let tokens = {};

export const handler = async function(event, context) {
  const path = event.path.split('/.netlify/functions/oauth')[1] || '';
  const queryParams = event.queryStringParameters || {};

  // Handle different paths
  if (path === '/install') {
    return handleInstall(queryParams);
  } else if (path === '/callback') {
    return handleCallback(queryParams);
  } else if (path === '/token') {
    return handleTokenRequest(queryParams);
  } else {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Not found' })
    };
  }
};

// Step 1: Handle install request
function handleInstall(queryParams) {
  const { shop } = queryParams;
  
  if (!shop) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Missing shop parameter' })
    };
  }

  // Generate a nonce for security
  const nonce = crypto.randomBytes(16).toString('hex');
  
  // Build the authorization URL
  const authUrl = `https://${shop}/admin/oauth/authorize?` +
    `client_id=${SHOPIFY_API_KEY}` +
    `&scope=write_draft_orders` +
    `&redirect_uri=${REDIRECT_URI}` +
    `&state=${nonce}`;
  
  // In production, store the nonce in a database
  
  return {
    statusCode: 302,
    headers: {
      'Location': authUrl
    },
    body: ''
  };
}

// Step 2: Handle OAuth callback
async function handleCallback(queryParams) {
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
    
    console.log(`Token obtained for ${shop}`);
    
    // Redirect back to app or show success page
    return {
      statusCode: 200,
      body: `
        <html>
          <body>
            <h1>Authentication Successful</h1>
            <p>Your app has been successfully authenticated with ${shop}.</p>
            <script>
              window.top.location.href = "https://${shop}/admin/apps";
            </script>
          </body>
        </html>
      `,
      headers: {
        'Content-Type': 'text/html'
      }
    };
  } catch (error) {
    console.error('Error exchanging code for token:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to complete OAuth' })
    };
  }
}

// Step 3: Provide token for API calls
function handleTokenRequest(queryParams) {
  const { shop } = queryParams;
  
  if (!shop || !tokens[shop]) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'No token found for this shop' })
    };
  }
  
  // In production, add authentication to this endpoint
  
  return {
    statusCode: 200,
    body: JSON.stringify({
      access_token: tokens[shop]
    })
  };
}