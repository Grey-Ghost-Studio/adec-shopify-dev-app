document.addEventListener('DOMContentLoaded', function() {
    const reserveForm = document.querySelector('.reserve__form');
    if (!reserveForm) {
        console.error('Reserve form not found');
        return;
    }

    reserveForm.addEventListener('submit', function(event) {
        // You can add form validation or submission handling here
        console.log('Form submitted');
        // Example: Collect form data
        const formData = {
            practiceName: document.getElementById('practice_name').value,
            zipCode: document.getElementById('zip_code').value,
            email: document.getElementById('email').value,
            role: document.getElementById('role').value
        };
        console.log('Form data:', formData);
        // You can add additional form processing or API calls here
        // 
    });


    // Modal functionality
    const modalTriggers = document.querySelectorAll('[data-modal-trigger]');
    console.log('Modal JS start');

    modalTriggers.forEach(trigger => {
      console.log('Modal trigger:', trigger);
      trigger.addEventListener('click', function() {
        const modalId = this.getAttribute('data-modal-trigger');
        const modal = document.getElementById(modalId);
        console.log('Modal click', modal);
        if (modal) {
          modal.classList.add('is-active');
          document.body.style.overflow = 'hidden'; // Prevent page scrolling
        }
      });
    });
    // Close modal functionality
    const closeButtons = document.querySelectorAll('[data-modal-close]');
    closeButtons.forEach(button => {
      button.addEventListener('click', function() {
        const modal = this.closest('.reserve-modal');
        
        if (modal) {
          modal.classList.remove('is-active');
          document.body.style.overflow = ''; // Restore page scrolling
        }
      });
    });
    // Close modal on ESC key
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        const activeModal = document.querySelector('.reserve-modal.is-active');
        
        if (activeModal) {
          activeModal.classList.remove('is-active');
          document.body.style.overflow = ''; // Restore page scrolling
        }
      }
    });

});