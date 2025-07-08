document.addEventListener('DOMContentLoaded', function() {
    const modalTriggers = document.querySelectorAll('[data-modal-trigger]');

    modalTriggers.forEach(trigger => {
      trigger.addEventListener('click', function() {
        const modalId = this.getAttribute('data-modal-trigger');
        const modal = document.getElementById(modalId);
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