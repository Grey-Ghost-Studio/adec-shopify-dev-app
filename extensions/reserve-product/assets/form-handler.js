// File location: extensions/your-extension-name/assets/form-handler.js

document.addEventListener('DOMContentLoaded', function() {
  // Store original button text when page loads
  const submitButton = document.querySelector('.submit-button');
  if (submitButton) {
    submitButton.setAttribute('data-original-text', submitButton.innerText);
  }
  
  // Select the form
  const reserveForm = document.querySelector('.reserve__form');
  if (reserveForm) {
    // Add submit event listener to the form
    reserveForm.addEventListener('submit', function(event) {
      // Prevent the default form submission
      event.preventDefault();
      
      // Get form values
      const practiceName = document.getElementById('practice_name').value;
      const zipCode = document.getElementById('zip_code').value;
      const email = document.getElementById('email').value;
      const role = document.getElementById('role').value;
      
      // Create draft order
      createDraftOrder({
        practice_name: practiceName,
        zip_code: zipCode,
        email: email,
        role: role
      });
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
          title: 'Reservation for ' + formData.practice_name,
          price: '0.00', // Free reservation
          quantity: 1
        }
      ],
      customer: {
        email: formData.email
      },
      note: `Practice Name: ${formData.practice_name}\nZIP/Postal Code: ${formData.zip_code}\nRole: ${formData.role}`,
      tags: `reservation, ${formData.role}, ${formData.zip_code}`
    }
  };
  
  // Get the current shop domain from the window location
  const shopDomain = Shopify.shop || window.location.hostname;
  // Create the app proxy URL - make sure this matches your App Proxy configuration
  const appProxyPath = '/apps/create-draft-order';
  // Current timestamp for signature verification
  const timestamp = Date.now();
  
  // Make API call to app proxy that will create the draft order
  fetch(`${appProxyPath}?shop=${shopDomain}&timestamp=${timestamp}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(draftOrderData)
  })
  .then(response => {
    if (!response.ok) {
      return response.json().then(errorData => {
        throw new Error(errorData.error || 'Unknown error occurred');
      });
    }
    return response.json();
  })
  .then(data => {
    // Handle successful response
    console.log('Draft order created:', data);
    
    // Show success message to user
    showMessage('success', 'Your reservation has been submitted successfully!');
    
    // Reset the form
    document.querySelector('.reserve__form').reset();
  })
  .catch(error => {
    // Handle error
    console.error('Error creating draft order:', error);
    showMessage('error', 'There was an error submitting your reservation. Please try again.');
  })
  .finally(() => {
    // Hide loading state
    toggleLoadingState(false);
  });
}

/**
 * Toggles loading state on the submit button
 * @param {boolean} isLoading - Whether loading state should be active
 */
function toggleLoadingState(isLoading) {
  const submitButton = document.querySelector('.submit-button');
  
  if (submitButton) {
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
}

/**
 * Displays a message to the user
 * @param {string} type - The type of message (success/error)
 * @param {string} message - The message text
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
    setTimeout(() => {
      messageElement.remove();
    }, 5000);
  }
}