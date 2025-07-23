document.addEventListener('DOMContentLoaded', function() {
  // Store original button text when page loads
  const submitButton = document.querySelector('.reserve__submit-button');
  if (submitButton) {
    submitButton.setAttribute('data-original-text', submitButton.innerText);
  }
  
  // Set up form submission
  const reserveForm = document.querySelector('.reserve__form');
  if (reserveForm) {
    reserveForm.addEventListener('submit', function(event) {
      event.preventDefault();
      
      // Show loading state immediately
      toggleLoadingState(true);
      
      // Collect form data first
      const formData = {
        practice_name: document.getElementById('practice_name').value,
        zip_code: document.getElementById('zip_code').value,
        email: document.getElementById('email').value,
        role: document.getElementById('role').value,
        language: document.getElementById('language').value || document.documentElement.lang || 'en'
      };
      
      // Capitalize role
      if (formData.role) {
        formData.role = formData.role.charAt(0).toUpperCase() + formData.role.slice(1);
      }
      
      // Get product information
      const productInfo = getProductInfo();
      
      // Execute reCAPTCHA v3 and get token
      if (typeof grecaptcha !== 'undefined') {
        grecaptcha.ready(function() {
          grecaptcha.execute('6LdEHUQrAAAAAA7jJ4O5eYyWjBieJo5WmWLCaRLH', {action: 'reserve_product'}).then(function(token) { // RECAPTCHA_SITE_KEY
            //console.log('reCAPTCHA v3 token received:', token.substring(0, 20) + '...');
            
            // Add the reCAPTCHA token to form data
            formData.recaptcha_token = token;
            
            // Create draft order with the token
            createDraftOrder(formData, productInfo);
          }).catch(function(error) {
            console.error('reCAPTCHA execution error:', error);
            toggleLoadingState(false);
            showMessage('error', 'Security verification failed. Please try again.');
          });
        });
      } else {
        console.error('reCAPTCHA not loaded');
        toggleLoadingState(false);
        showMessage('error', 'Security verification not available. Please refresh the page and try again.');
      }
    });
  }
  
  // Load reCAPTCHA v3 script if not already loaded
  if (typeof grecaptcha === 'undefined') {
    const recaptchaScript = document.createElement('script');
    recaptchaScript.src = 'https://www.google.com/recaptcha/api.js?render=6LdEHUQrAAAAAA7jJ4O5eYyWjBieJo5WmWLCaRLH'; // RECAPTCHA_SITE_KEY
    recaptchaScript.async = true;
    recaptchaScript.defer = true;
    document.head.appendChild(recaptchaScript);
    
    // Add error handling for script loading
    recaptchaScript.onerror = function() {
      console.error('Failed to load reCAPTCHA script');
    };
  }
});

/**
 * Extracts product information from the current page
 * @returns {Object} Product information
 */
function getProductInfo() {
  let productInfo = {
    title: null,
    price: '0.00',
    handle: null,
    variant_id: null,
    sku: null,
    stocking_number: null
  };
  
  try {
    // Method 1: Try to get product JSON from the page
    const productJson = document.getElementById('ProductJson-product-template');
    if (productJson && productJson.textContent) {
      //console.log("Found product JSON in page");
      const product = JSON.parse(productJson.textContent);
      
      productInfo.title = product.title;
      productInfo.handle = product.handle;
      
      //console.log("Product JSON data:", {
      //   title: product.title,
      //   variants_count: product.variants ? product.variants.length : 0
      // });
      
      // Try to get stocking number from metafields if available in JSON
      if (product.metafields && product.metafields.custom && product.metafields.custom.stocking_number) {
        productInfo.stocking_number = product.metafields.custom.stocking_number;
      }
      
      // If no stocking number was found in metafields, try using the handle as stocking number
      if (!productInfo.stocking_number && product.handle && product.handle.match(/^[Rr][0-9]+$/)) {
        productInfo.stocking_number = product.handle;
        //console.log(`Using handle as stocking number: ${productInfo.stocking_number}`);
      }
      
      // Get selected variant if available
      const selectedVariantId = getSelectedVariantId();
      
      // Find the selected variant or use the first one
      let selectedVariant = null;
      if (product.variants && product.variants.length > 0) {
        if (selectedVariantId) {
          selectedVariant = product.variants.find(v => String(v.id) === String(selectedVariantId));
        }
        
        if (!selectedVariant) {
          selectedVariant = product.variants[0];
        }
        
        if (selectedVariant) {
          productInfo.variant_id = selectedVariant.id;
          productInfo.price = (selectedVariant.price / 100).toFixed(2);
          productInfo.sku = selectedVariant.sku;
          
          //console.log(`Using variant: ID=${selectedVariant.id}, Price=${productInfo.price}, SKU=${productInfo.sku}`);
        }
      } else if (product.price !== undefined) {
        productInfo.price = (product.price / 100).toFixed(2);
      }
    } else {
      //console.log("No product JSON found, trying alternative methods");
      
      // Method 2: Try to get product title from meta tags
      const productTitle = document.querySelector('meta[property="og:title"]');
      if (productTitle) productInfo.title = productTitle.content;
      
      // Method 3: Try to get stocking number from DOM element
      const stockingNumberElement = document.querySelector('[data-stocking-number]');
      if (stockingNumberElement) {
        productInfo.stocking_number = stockingNumberElement.getAttribute('data-stocking-number') || 
                                      stockingNumberElement.textContent.trim();
      } else {
        // Alternative method to find stocking number in the DOM
        // Look for it in the page content
        const stockingElements = document.querySelectorAll('*:not(script):not(style)');
        for (let i = 0; i < stockingElements.length; i++) {
          const element = stockingElements[i];
          const text = element.textContent;
          if (text && text.includes('Stocking #')) {
            const match = text.match(/Stocking #([A-Z0-9-]+)/);
            if (match && match[1]) {
              productInfo.stocking_number = match[1].trim();
              break;
            }
          }
        }
      }
      
      // Method 4: Try to get price from the page elements
      const priceElement = document.querySelector('[data-product-price]');
      if (priceElement) {
        const price = priceElement.getAttribute('data-product-price') || priceElement.textContent;
        if (price) {
          // Remove currency symbols and convert to number
          const numericPrice = parseFloat(price.replace(/[^0-9.]/g, ''));
          if (!isNaN(numericPrice)) {
            productInfo.price = numericPrice.toFixed(2);
          }
        }
      }
      
      // Method 5: Try to get product info from current URL
      try {
        const pathParts = window.location.pathname.split('/');
        const productsIndex = pathParts.indexOf('products');
        if (productsIndex >= 0 && pathParts.length > productsIndex + 1) {
          productInfo.handle = pathParts[productsIndex + 1];
          //console.log(`Found product handle in URL: ${productInfo.handle}`);
          
          // Check if handle looks like a stocking number (starts with R followed by numbers)
          if (productInfo.handle.match(/^[Rr][0-9]+$/)) {
            productInfo.stocking_number = productInfo.handle;
            //console.log(`Using handle as stocking number: ${productInfo.stocking_number}`);
          }
          
          // If we have a handle but no title, use the handle as a fallback
          if (!productInfo.title && productInfo.handle) {
            productInfo.title = productInfo.handle
              .split('-')
              .map(word => word.charAt(0).toUpperCase() + word.slice(1))
              .join(' ');
          }
        }
      } catch (urlError) {
        console.error("Error extracting product info from URL:", urlError);
      }
    }
    
    // Try to get variant ID from a form with product ID
    const productForm = document.querySelector('form[action*="/cart/add"]');
    if (productForm) {
      const productInput = productForm.querySelector('input[name="id"]');
      if (productInput) {
        productInfo.variant_id = productInput.value;
        //console.log(`Found variant ID in product form: ${productInfo.variant_id}`);
      }
    }

    // Look for product info in Shopify.product object if it exists
    if (window.Shopify && window.Shopify.product) {
      const shopifyProduct = window.Shopify.product;
      //console.log("Found Shopify.product:", shopifyProduct);
      
      if (!productInfo.title && shopifyProduct.title) {
        productInfo.title = shopifyProduct.title;
      }
      
      if (shopifyProduct.handle) {
        productInfo.handle = shopifyProduct.handle;
        //console.log(`Found product handle in Shopify.product: ${productInfo.handle}`);
        
        // Check if handle looks like a stocking number (starts with R followed by numbers)
        if (shopifyProduct.handle.match(/^[Rr][0-9]+$/)) {
          productInfo.stocking_number = shopifyProduct.handle;
          //console.log(`Using handle as stocking number: ${productInfo.stocking_number}`);
        }
      }
      
      if (shopifyProduct.variants && shopifyProduct.variants.length > 0) {
        const firstVariant = shopifyProduct.variants[0];
        
        if (!productInfo.variant_id) {
          productInfo.variant_id = firstVariant.id;
          //console.log(`Found variant ID in Shopify.product: ${productInfo.variant_id}`);
        }
        
        if (firstVariant.price) {
          productInfo.price = (parseFloat(firstVariant.price) / 100).toFixed(2);
        }
        
        if (firstVariant.sku) {
          productInfo.sku = firstVariant.sku;
        }
      }
    }
    
    // Clean up variant ID - ensure it's numeric
    if (productInfo.variant_id) {
      if (typeof productInfo.variant_id === 'string' && productInfo.variant_id.includes('gid://')) {
        productInfo.variant_id = productInfo.variant_id.split('/').pop();
        //console.log(`Extracted numeric variant ID from GraphQL ID: ${productInfo.variant_id}`);
      } else if (typeof productInfo.variant_id === 'string') {
        productInfo.variant_id = parseInt(productInfo.variant_id, 10);
      }
    }

    if (!productInfo.stocking_number && productInfo.handle && productInfo.handle.match(/^[Rr][0-9]+$/)) {
      productInfo.stocking_number = productInfo.handle;
      //console.log(`Using handle as stocking number: ${productInfo.stocking_number}`);
    }
    
    //console.log("Final product info:", JSON.stringify(productInfo, null, 2));
  } catch (error) {
    console.error('Error getting product info:', error);
  }
  
  return productInfo;
}

/**
 * Gets the currently selected variant ID
 * @returns {string|null} The selected variant ID
 */
function getSelectedVariantId() {
  const urlParams = new URLSearchParams(window.location.search);
  const variantId = urlParams.get('variant');
  if (variantId) {
    //console.log(`Found variant ID in URL: ${variantId}`);
    return variantId;
  }
  
  const variantSelector = document.querySelector('[name="id"]');
  if (variantSelector) {
    //console.log(`Found variant ID in selector: ${variantSelector.value}`);
    return variantSelector.value;
  }
  
  //console.log("No variant ID found");
  return null;
}

/**
 * Creates a draft order using Shopify App Proxy
 * @param {Object} formData - The form data from the submission
 * @param {Object} productInfo - The product information
 */
function createDraftOrder(formData, productInfo) {
  // Create custom draft order title with stocking number and practice name
  let draftOrderTitle = '';
  
  if (productInfo.stocking_number) {
    draftOrderTitle += `${productInfo.stocking_number.toUpperCase()} - `;
  }
  
  draftOrderTitle += `${productInfo.title || 'Product'} - ${formData.practice_name}`;
  
  //console.log("Creating draft order with title:", draftOrderTitle);
  //console.log("Complete product info for draft order:", JSON.stringify(productInfo, null, 2));
  
  // Create line item from product info
  const lineItem = {
    title: productInfo.stocking_number ? 
      `${productInfo.stocking_number.toUpperCase()} - ${productInfo.title || 'Product'}` : 
      productInfo.title || `Reserved Product`,
    price: productInfo.price || '0.00',
    quantity: 1
  };
  
  // Add variant ID if available
  if (productInfo.variant_id) {
    const variantId = typeof productInfo.variant_id === 'string' && productInfo.variant_id.includes('gid://') 
      ? productInfo.variant_id.split('/').pop()
      : productInfo.variant_id;
    
    lineItem.variant_id = variantId;
    //console.log(`Setting variant_id: ${variantId}`);
  }
  
  // Add SKU if available
  if (productInfo.sku) {
    lineItem.sku = productInfo.sku;
  }
  
  // Add stocking number as a property if available
  lineItem.properties = [];
  if (productInfo.stocking_number) {
    lineItem.properties.push({ name: "Stocking Number", value: productInfo.stocking_number.toUpperCase() });
  }
  
  // Create draft order tags
  let orderTags = [];
  
  if (productInfo.stocking_number) {
    orderTags.push(productInfo.stocking_number.toUpperCase());
  }
  
  orderTags.push('reservation');
  if (formData.role) {
    orderTags.push(formData.role);
  }
  if (formData.zip_code) {
    orderTags.push(formData.zip_code);
  }
  
  // Create draft order note
  let orderNote = '';
  orderNote += `Reservation Number: \n`; // This will be filled by the serverless function
  orderNote += `Practice Name: ${formData.practice_name}\n`;
  orderNote += `Email: ${formData.email}\n`;
  orderNote += `ZIP/Postal Code: ${formData.zip_code}\n`;
  orderNote += `Role: ${formData.role}\n`;
  orderNote += `Language: ${formData.language === 'fr' ? 'French' : 'English'}\n`;
  
  // Create the draft order data structure
  const draftOrderData = {
    draft_order: {
      name: draftOrderTitle,
      line_items: [lineItem],
      customer: { email: formData.email },
      note: orderNote,
      tags: orderTags.join(', ')
    },
    language: formData.language,
    recaptcha_token: formData.recaptcha_token,
    recaptcha_action: 'reserve_product' // Add action for v3 verification
  };
  
  //console.log("Sending draft order data:", JSON.stringify(draftOrderData, null, 2));
  
  // Get the shop domain and create the app proxy URL
  const shopDomain = Shopify.shop || window.location.hostname;
  const appProxyPath = '/apps/create-draft-order';
  const timestamp = Date.now();
  const url = `${appProxyPath}?shop=${shopDomain}&timestamp=${timestamp}`;
  
  // Send the request
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draftOrderData)
  })
  .then(response => {
    if (!response.ok) {
      return response.text().then(text => {
        console.error("Error response:", text);
        throw new Error(`Request failed with status ${response.status}: ${text}`);
      });
    }
    return response.json();
  })
  .then(data => {
    //console.log("Draft order created successfully!");
    //console.log("FULL RESPONSE DATA:", JSON.stringify(data, null, 2));
    
    // Continue with your existing success handling...
    // [Rest of success handling remains the same as your original code]
    
    // Create confirmation page URL with language path
    const basePath = formData.language === 'en' || !formData.language
      ? '/pages/reservation-confirmation'
      : `/${formData.language}/pages/reservation-confirmation`;
    const confirmationUrl = new URL(basePath, window.location.origin);

    // Get reservation number from response
    let reservationNumber = data.reservation_number;
    if (!reservationNumber) {
      const now = new Date();
      const timestamp = now.getTime().toString().slice(-6);
      reservationNumber = `TEMP-${timestamp}`;
    }
    
    // Add parameters to confirmation URL including language
    confirmationUrl.searchParams.append('reservation_number', reservationNumber);
    confirmationUrl.searchParams.append('stocking_number', productInfo.stocking_number || '');
    confirmationUrl.searchParams.append('practice_name', formData.practice_name || '');
    confirmationUrl.searchParams.append('email', formData.email || '');
    confirmationUrl.searchParams.append('zip_code', formData.zip_code || '');
    confirmationUrl.searchParams.append('role', formData.role || '');
    confirmationUrl.searchParams.append('product_title', productInfo.title || '');
    confirmationUrl.searchParams.append('language', formData.language || 'en');
    
    //console.log("Redirecting to confirmation page:", confirmationUrl.toString());
    window.location.href = confirmationUrl.toString();
  })
  .catch(error => {
    console.error('Error creating draft order:', error);
    showMessage('error', 'There was an error submitting your reservation. Please try again.');
    toggleLoadingState(false);
  });
}

/**
 * Toggles loading state on the submit button
 */
function toggleLoadingState(isLoading) {
  const submitButton = document.querySelector('.reserve__submit-button');
  const submitButtonText = submitButton ? submitButton.innerText : '';
  if (!submitButton) return;
  
  if (isLoading) {
    submitButton.disabled = true;
    submitButton.classList.add('is-loading');
    submitButton.innerText = 'Submitting...';
  } else {
    submitButton.disabled = false;
    submitButton.classList.remove('is-loading');
    submitButton.innerText = submitButtonText || 'Submit';
  }
}

/**
 * Displays a message to the user
 */
function showMessage(type, message) {
  const existingMessage = document.querySelector('.form-message');
  if (existingMessage) {
    existingMessage.remove();
  }
  
  const messageElement = document.createElement('div');
  messageElement.className = `form-message form-message--${type}`;
  messageElement.innerText = message;
  
  const form = document.querySelector('.reserve__form');
  form.parentNode.insertBefore(messageElement, form.nextSibling);
  
  if (type === 'success') {
    setTimeout(() => messageElement.remove(), 5000);
  }
}