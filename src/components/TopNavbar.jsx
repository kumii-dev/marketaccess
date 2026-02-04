import { useState } from 'react';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './TopNavbar.css';

const TopNavbar = () => {
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [notificationCount] = useState(3);

  const toggleDarkMode = () => {
    setIsDarkMode(!isDarkMode);
    // You can add dark mode logic here
  };

  return (
    <nav className="top-navbar">
      <div className="navbar-left">
        <div className="navbar-logo">
          <img 
            src="/Kumii-logo-new-slogan-03.png" 
            alt="KUMii Logo" 
            className="logo-image"
          />
        </div>
      </div>

      <div className="navbar-right">
        <button 
          className="navbar-btn theme-toggle"
          onClick={toggleDarkMode}
          title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
        >
          <i className={`bi ${isDarkMode ? 'bi-sun' : 'bi-brightness-high'}`}></i>
        </button>

        <button className="navbar-btn mode-toggle" title="User Mode">
          <i className="bi bi-person"></i>
          <span>User Mode</span>
        </button>

        <button className="navbar-btn admin-link" title="Switch to Admin">
          <span>Switch to Admin</span>
        </button>

        <button className="navbar-btn about-link" title="About">
          <span>About</span>
        </button>

        <button className="navbar-btn notification-btn" title="Notifications">
          <i className="bi bi-bell"></i>
          {notificationCount > 0 && (
            <span className="notification-badge">{notificationCount}</span>
          )}
        </button>

        <div className="navbar-divider"></div>

        <button className="navbar-btn profile-btn" title="Profile">
          <i className="bi bi-person-circle"></i>
          <span>Profile</span>
        </button>

        <button className="navbar-btn signout-btn" title="Sign Out">
          <span>Sign Out</span>
        </button>

        <div className="user-email">
          <span>mncubekhulekani@gmail.com</span>
        </div>
      </div>
    </nav>
  );
};

export default TopNavbar;
