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
      
      // Create draft order
      createDraftOrder(formData);
    });
  }
});

/**
 * Creates a draft order using Shopify App Proxy
 * @param {Object} formData - The form data from the submission
 */
function createDraftOrder(formData) {
  // Show loading state
  toggleLoadingState(true);
  
  // Create the draft order data structure
  const draftOrderData = {
    draft_order: {
      line_items: [
        {
          title: `Reservation for ${formData.practice_name}`,
          price: '0.00',
          quantity: 1
        }
      ],
      customer: { email: formData.email },
      note: `Practice Name: ${formData.practice_name}\nZIP/Postal Code: ${formData.zip_code}\nRole: ${formData.role}`,
      tags: `reservation, ${formData.role}, ${formData.zip_code}`
    }
  };
  
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