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
    variant_title: null,
    sku: null
  };
  
  try {
    // Method 1: Try to get product JSON from the page
    const productJson = document.getElementById('ProductJson-product-template');
    if (productJson && productJson.textContent) {
      console.log("Found product JSON in page");
      const product = JSON.parse(productJson.textContent);
      
      productInfo.id = product.id;
      productInfo.title = product.title;
      productInfo.handle = product.handle;
      
      // Get selected variant if available
      const selectedVariantId = getSelectedVariantId();
      console.log("Selected variant ID:", selectedVariantId);
      
      const selectedVariant = selectedVariantId ? 
        product.variants.find(v => v.id == selectedVariantId) : 
        product.variants[0];
      
      if (selectedVariant) {
        productInfo.variant_id = selectedVariant.id;
        productInfo.variant_title = selectedVariant.title !== "Default Title" ? selectedVariant.title : null;
        productInfo.price = (selectedVariant.price / 100).toFixed(2); // Convert cents to dollars
        productInfo.sku = selectedVariant.sku;
        
        console.log("Selected variant info:", {
          id: productInfo.variant_id,
          title: productInfo.variant_title,
          price: productInfo.price,
          sku: productInfo.sku
        });
      }
    } else {
      console.log("No product JSON found, trying alternative methods");
      
      // Method 2: Try to get product info from meta tags
      const productIdMeta = document.querySelector('meta[property="product:product_id"]');
      const productTitle = document.querySelector('meta[property="og:title"]');
      
      if (productIdMeta) productInfo.id = productIdMeta.content;
      if (productTitle) productInfo.title = productTitle.content;
      
      // Method 3: Try to get price from the page elements
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
      
      // Method 4: Try to get product info from current URL
      try {
        const pathParts = window.location.pathname.split('/');
        const productsIndex = pathParts.indexOf('products');
        if (productsIndex >= 0 && pathParts.length > productsIndex + 1) {
          productInfo.handle = pathParts[productsIndex + 1];
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
  if (variantId) return variantId;
  
  // Try to get from variant selector
  const variantSelector = document.querySelector('[name="id"]');
  if (variantSelector) return variantSelector.value;
  
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
  
  // Create line item from product info
  const lineItem = {
    title: productInfo.title || `Reservation for ${formData.practice_name}`,
    price: productInfo.price || '0.00',
    quantity: 1
  };
  
  // Add SKU if available
  if (productInfo.sku) {
    lineItem.sku = productInfo.sku;
  }
  
  // Add line item properties for practice info and product details
  lineItem.properties = [
    { name: "Practice Name", value: formData.practice_name }
  ];
  
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
  
  // Create the draft order data structure
  const draftOrderData = {
    draft_order: {
      line_items: [lineItem],
      customer: { email: formData.email },
      note: `Practice Name: ${formData.practice_name}\nZIP/Postal Code: ${formData.zip_code}\nRole: ${formData.role}\nProduct: ${productInfo.title || 'N/A'}`,
      tags: `reservation, ${formData.role}, ${formData.zip_code}`
    }
  };
  
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
      throw new Error(`Request failed with status ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    // Handle success
    console.log("Draft order created successfully:", data);
    showMessage('success', 'Your reservation has been submitted successfully!');
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