document.addEventListener('DOMContentLoaded', () => {
  const themeDropdown = document.getElementById('theme-dropdown');
  if (themeDropdown) {
    // Function to set the theme based on the dropdown selection
    function setTheme(theme) {
      // Remove all theme-related classes first
      document.body.classList.remove('theme-day', 'theme-night', 'theme-ocean', 'theme-nature', 'theme-volcano', 'theme-sky');

      // Add the selected theme
      document.body.classList.add('theme-' + theme);

      // Save the theme to localStorage
      localStorage.setItem('theme', theme);
    }

    // Apply the stored theme on page load
    const storedTheme = localStorage.getItem('theme') || 'day';  // Default to 'day' theme
    setTheme(storedTheme);

    // Add event listeners for each theme option in the dropdown
    themeDropdown.addEventListener('click', (event) => {
      event.preventDefault();

      const selectedTheme = event.target.getAttribute('data-theme');

      if (selectedTheme) {
        setTheme(selectedTheme);
        console.log(`Theme ${selectedTheme} selected`)
      }
    });
  }

  // Fetch and update notification count
  function updateNotificationCount() {
    const badge = document.querySelector('.notification-badge');
    if (badge) {
      fetch('/api/v1/notifications/count')
        .then(response => response.json())
        .then(data => {
          if (data.count > 0) {
            badge.textContent = data.count;
            badge.classList.remove('hidden');
          } else {
            badge.classList.add('hidden');
          }
        })
        .catch(error => console.error('Error fetching notification count:', error));
    }
  }

  // Update notification count on page load and every 5 minutes
  const notificationBadge = document.querySelector('.notification-badge');
  if (notificationBadge) {
    updateNotificationCount();
    setInterval(updateNotificationCount, 300000);
  }

  // Function to update message count for admins
  function updateMessageCount() {
    const messageCountElement = document.querySelector('.message-count');
    if (messageCountElement) {  // Only proceed if admin (element exists)
      fetch('/messages/count')
        .then(response => response.json())
        .then(data => {
          if (data.count > 0) {
            messageCountElement.textContent = data.count;
            messageCountElement.classList.remove('hidden');
          } else {
            messageCountElement.classList.add('hidden');
          }
        })
        .catch(error => console.error('Error fetching message count:', error));
    }
  }

  // Update message count on page load and every 5 minutes
  const messageCount = document.querySelector('.message-count');
  if (messageCount) {
    updateMessageCount();
    setInterval(updateMessageCount, 300000);
  }
});
