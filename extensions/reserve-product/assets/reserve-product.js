document.addEventListener('DOMContentLoaded', function() {
    const form = document.querySelector('.practice-form');
    
    form.addEventListener('submit', function(event) {
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
    });
});