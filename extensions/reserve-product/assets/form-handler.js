document.addEventListener('DOMContentLoaded', function() {
  // Store original button text when page loads
  const submitButton = document.querySelector('.submit-button');
  if (submitButton) {
    submitButton.setAttribute('data-original-text', submitButton.innerText);
  }
  
  // Set up form submission
  const reserveForm = document.querySelector('.reserve__form');
  if (reserveForm) {
    reserveForm.addEventListener('submit', function(event) {
      event.preventDefault();
      
      // Collect form data
      const formData = {
        practice_name: document.getElementById('practice_name').value,
        zip_code: document.getElementById('zip_code').value,
        email: document.getElementById('email').value,
        role: document.getElementById('role').value
      };
      
      // Get product information from meta tags or product JSON
      const productInfo = getProductInfo();
      
      // Create draft order
      createDraftOrder(formData, productInfo);
    });
  }
});

/**
 * Extracts product information from the current page
 * @returns {Object} Product information
 */
function getProductInfo() {
  let productInfo = {
    id: null,
    title: null,
    price: '0.00',
    handle: null,
    variant_id: null,
    sku: null,
    stocking_number: null // Added stocking number field
  };
  
  try {
    // Method 1: Try to get product JSON from the page
    const productJson = document.getElementById('ProductJson-product-template');
    if (productJson && productJson.textContent) {
      console.log("Found product JSON in page");
      const product = JSON.parse(productJson.textContent);
      
      // Log product JSON for debugging
      console.log("Raw product JSON:", JSON.stringify(product, null, 2));
      
      productInfo.id = product.id;
      productInfo.title = product.title;
      productInfo.handle = product.handle;
      
      // Try to get stocking number from metafields if available in JSON
      if (product.metafields && product.metafields.custom && product.metafields.custom.stocking_number) {
        productInfo.stocking_number = product.metafields.custom.stocking_number;
      }
      
      // If no stocking number was found in metafields, try using the handle as stocking number
      if (!productInfo.stocking_number && product.handle && product.handle.match(/^[Rr][0-9]+$/)) {
        productInfo.stocking_number = product.handle;
        console.log(`Using handle as stocking number: ${productInfo.stocking_number}`);
      }
      
      // Get selected variant if available
      const selectedVariantId = getSelectedVariantId();
      
      // Find the selected variant or use the first one
      let selectedVariant = null;
      if (product.variants && product.variants.length > 0) {
        if (selectedVariantId) {
          // Convert both to strings for comparison to avoid type issues
          selectedVariant = product.variants.find(v => String(v.id) === String(selectedVariantId));
        }
        
        // If no variant was found or no variant ID was provided, use first variant
        if (!selectedVariant) {
          selectedVariant = product.variants[0];
        }
        
        if (selectedVariant) {
          productInfo.variant_id = selectedVariant.id;
          productInfo.price = (selectedVariant.price / 100).toFixed(2); // Convert cents to dollars
          productInfo.sku = selectedVariant.sku;
          
          console.log(`Using variant: ID=${selectedVariant.id}, Price=${productInfo.price}, SKU=${productInfo.sku}`);
        }
      } else if (product.price !== undefined) {
        // Some product JSON might have price at the product level
        productInfo.price = (product.price / 100).toFixed(2);
      }
    } else {
      // Method 2: Try to find the product ID in other ways
      
      // Try to get product ID from a form with product ID
      const productForm = document.querySelector('form[action*="/cart/add"]');
      if (productForm) {
        const productInput = productForm.querySelector('input[name="id"]');
        if (productInput) {
          productInfo.variant_id = productInput.value;
          console.log(`Found variant ID in product form: ${productInfo.variant_id}`);
          
          // Try to extract product ID from data attributes
          if (productForm.hasAttribute('data-product-id')) {
            productInfo.id = productForm.getAttribute('data-product-id');
            console.log(`Found product ID in form attribute: ${productInfo.id}`);
          }
        }
      }
      
      // Try to get product info from meta tags
      const productIdMeta = document.querySelector('meta[property="product:product_id"]');
      const productTitle = document.querySelector('meta[property="og:title"]');
      
      if (productIdMeta) {
        productInfo.id = productIdMeta.content;
        console.log(`Found product ID in meta tag: ${productInfo.id}`);
      }
      if (productTitle) productInfo.title = productTitle.content;
      
      // Look for product info in Shopify.product object if it exists
      if (window.Shopify && window.Shopify.product) {
        const shopifyProduct = window.Shopify.product;
        console.log("Found Shopify.product:", shopifyProduct);
        
        if (!productInfo.id && shopifyProduct.id) {
          productInfo.id = shopifyProduct.id;
          console.log(`Found product ID in Shopify.product: ${productInfo.id}`);
        }
        
        if (!productInfo.title && shopifyProduct.title) {
          productInfo.title = shopifyProduct.title;
        }
        
        if (shopifyProduct.handle) {
          productInfo.handle = shopifyProduct.handle;
          console.log(`Found product handle in Shopify.product: ${productInfo.handle}`);
          
          // Check if handle looks like a stocking number (starts with R followed by numbers)
          if (shopifyProduct.handle.match(/^[Rr][0-9]+$/)) {
            productInfo.stocking_number = shopifyProduct.handle;
            console.log(`Using handle as stocking number: ${productInfo.stocking_number}`);
          }
        }
        
        if (shopifyProduct.variants && shopifyProduct.variants.length > 0) {
          const firstVariant = shopifyProduct.variants[0];
          
          if (!productInfo.variant_id) {
            productInfo.variant_id = firstVariant.id;
            console.log(`Found variant ID in Shopify.product: ${productInfo.variant_id}`);
          }
          
          if (firstVariant.price) {
            productInfo.price = (parseFloat(firstVariant.price) / 100).toFixed(2);
          }
          
          if (firstVariant.sku) {
            productInfo.sku = firstVariant.sku;
          }
        }
      }
      
      // Try to get stocking number from DOM element
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
      
      // Try to get price from the page elements
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
      
      // Try to get product info from current URL
      try {
        const pathParts = window.location.pathname.split('/');
        const productsIndex = pathParts.indexOf('products');
        if (productsIndex >= 0 && pathParts.length > productsIndex + 1) {
          productInfo.handle = pathParts[productsIndex + 1];
          console.log(`Found product handle in URL: ${productInfo.handle}`);
          
          // Check if handle looks like a stocking number (starts with R followed by numbers)
          if (productInfo.handle.match(/^[Rr][0-9]+$/)) {
            productInfo.stocking_number = productInfo.handle;
            console.log(`Using handle as stocking number: ${productInfo.stocking_number}`);
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
    
    // Clean up IDs - ensure they're numeric and not in Shopify GraphQL format
    if (productInfo.id) {
      if (typeof productInfo.id === 'string' && productInfo.id.includes('gid://')) {
        productInfo.id = productInfo.id.split('/').pop();
      } else if (typeof productInfo.id === 'string') {
        productInfo.id = parseInt(productInfo.id, 10);
      }
    }
    
    if (productInfo.variant_id) {
      if (typeof productInfo.variant_id === 'string' && productInfo.variant_id.includes('gid://')) {
        productInfo.variant_id = productInfo.variant_id.split('/').pop();
      } else if (typeof productInfo.variant_id === 'string') {
        productInfo.variant_id = parseInt(productInfo.variant_id, 10);
      }
    }
    
    console.log("Final product info:", productInfo);
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
  // Try to get variant ID from URL
  const urlParams = new URLSearchParams(window.location.search);
  const variantId = urlParams.get('variant');
  if (variantId) {
    console.log(`Found variant ID in URL: ${variantId}`);
    return variantId;
  }
  
  // Try to get from variant selector
  const variantSelector = document.querySelector('[name="id"]');
  if (variantSelector) {
    console.log(`Found variant ID in selector: ${variantSelector.value}`);
    return variantSelector.value;
  }
  
  console.log("No variant ID found");
  return null;
}

/**
 * Creates a draft order using Shopify App Proxy
 * @param {Object} formData - The form data from the submission
 * @param {Object} productInfo - The product information
 */
function createDraftOrder(formData, productInfo) {
  // Show loading state
  toggleLoadingState(true);
  
  // Use the handle as stocking number if it follows the pattern and we don't have one already
  if (!productInfo.stocking_number && productInfo.handle && productInfo.handle.match(/^[Rr][0-9]+$/)) {
    productInfo.stocking_number = productInfo.handle;
    console.log(`Using handle as stocking number: ${productInfo.stocking_number}`);
  }
  
  // Create custom draft order title with stocking number and practice name
  let draftOrderTitle = '';
  
  if (productInfo.stocking_number) {
    draftOrderTitle += `${productInfo.stocking_number.toUpperCase()} - `;
  }
  
  draftOrderTitle += `${productInfo.title || 'Product'} - ${formData.practice_name}`;
  
  console.log("Creating draft order with title:", draftOrderTitle);
  
  // Log all product info for debugging
  console.log("Complete product info for draft order:", JSON.stringify(productInfo, null, 2));
  
  // Create line item from product info
  const lineItem = {
    title: productInfo.stocking_number ? 
      `${productInfo.stocking_number.toUpperCase()} - ${productInfo.title || 'Product'}` : 
      productInfo.title || `Reservation for ${formData.practice_name}`,
    price: productInfo.price || '0.00',
    quantity: 1
  };
  
  // Add product ID to ensure proper linking in Shopify admin
  if (productInfo.id) {
    // Convert ID to proper format if needed
    const productId = typeof productInfo.id === 'string' && productInfo.id.includes('gid://') 
      ? productInfo.id.split('/').pop() // Extract ID from Shopify GraphQL ID format
      : productInfo.id;
    
    lineItem.product_id = productId;
    console.log(`Setting product_id: ${productId}`);
  }
  
  // Add variant ID if available
  if (productInfo.variant_id) {
    // Convert ID to proper format if needed
    const variantId = typeof productInfo.variant_id === 'string' && productInfo.variant_id.includes('gid://') 
      ? productInfo.variant_id.split('/').pop() // Extract ID from Shopify GraphQL ID format
      : productInfo.variant_id;
    
    lineItem.variant_id = variantId;
    console.log(`Setting variant_id: ${variantId}`);
  }
  
  // Add SKU if available
  if (productInfo.sku) {
    lineItem.sku = productInfo.sku;
  }
  
  // Add line item properties for practice info and product details
  lineItem.properties = [
    { name: "Practice Name", value: formData.practice_name }
  ];
  
  // Add stocking number as a property if available
  if (productInfo.stocking_number) {
    lineItem.properties.push({ name: "Stocking Number", value: productInfo.stocking_number.toUpperCase() });
  }
  
  // Create draft order tags with stocking number at the beginning for visibility
  let orderTags = [];
  
  // Add stocking number tag first if available
  if (productInfo.stocking_number) {
    orderTags.push(`stock-${productInfo.stocking_number.toUpperCase()}`);
  }
  
  // Add other tags
  orderTags.push('reservation');
  if (formData.role) {
    orderTags.push(formData.role);
  }
  if (formData.zip_code) {
    orderTags.push(formData.zip_code);
  }
  
  // Create draft order note with stocking number prominently displayed
  let orderNote = '';
  
  // Add stocking number as the first line if available
  if (productInfo.stocking_number) {
    orderNote += `STOCKING NUMBER: ${productInfo.stocking_number.toUpperCase()}\n\n`;
  }
  
  // Add other information
  orderNote += `Practice Name: ${formData.practice_name}\n`;
  orderNote += `ZIP/Postal Code: ${formData.zip_code}\n`;
  orderNote += `Role: ${formData.role}\n`;
  orderNote += `Product: ${productInfo.title || 'N/A'}\n`;
  
  // Create the draft order data structure
  const draftOrderData = {
    draft_order: {
      name: draftOrderTitle,
      line_items: [lineItem],
      customer: { email: formData.email },
      note: orderNote,
      tags: orderTags.join(', ')
    }
  };
  
  // Add stocking number if available
  if (productInfo.stocking_number) {
    lineItem.properties.push({ name: "Stocking Number", value: productInfo.stocking_number });
  }
  
  // Add product ID if available
  if (productInfo.id) {
    lineItem.properties.push({ name: "Product ID", value: productInfo.id });
  }
  
  // Add variant details if available
  if (productInfo.variant_id) {
    lineItem.properties.push({ name: "Variant ID", value: productInfo.variant_id });
    
    if (productInfo.variant_title) {
      lineItem.properties.push({ name: "Variant", value: productInfo.variant_title });
    }
  }
  
  console.log("Sending draft order data:", JSON.stringify(draftOrderData));
  
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
    // Handle success
    console.log("Draft order created successfully:", data);
    
    // Create success message with stocking number if available
    let successMessage = 'Your reservation has been submitted successfully!';
    if (productInfo.stocking_number) {
      successMessage = `Your reservation for ${productInfo.stocking_number.toUpperCase()} has been submitted successfully!`;
    }
    
    showMessage('success', successMessage);
    document.querySelector('.reserve__form').reset();
  })
  .catch(error => {
    // Handle error
    console.error('Error creating draft order:', error);
    showMessage('error', 'There was an error submitting your reservation. Please try again.');
  })
  .finally(() => {
    toggleLoadingState(false);
  });
}

/**
 * Toggles loading state on the submit button
 */
function toggleLoadingState(isLoading) {
  const submitButton = document.querySelector('.submit-button');
  if (!submitButton) return;
  
  if (isLoading) {
    submitButton.disabled = true;
    submitButton.classList.add('is-loading');
    submitButton.innerText = 'Submitting...';
  } else {
    submitButton.disabled = false;
    submitButton.classList.remove('is-loading');
    submitButton.innerText = submitButton.getAttribute('data-original-text') || 'Submit';
  }
}

/**
 * Displays a message to the user
 */
function showMessage(type, message) {
  // Remove any existing message
  const existingMessage = document.querySelector('.form-message');
  if (existingMessage) {
    existingMessage.remove();
  }
  
  // Create message element
  const messageElement = document.createElement('div');
  messageElement.className = `form-message form-message--${type}`;
  messageElement.innerText = message;
  
  // Insert message after form
  const form = document.querySelector('.reserve__form');
  form.parentNode.insertBefore(messageElement, form.nextSibling);
  
  // Auto-remove success messages after delay
  if (type === 'success') {
    setTimeout(() => messageElement.remove(), 5000);
  }
}