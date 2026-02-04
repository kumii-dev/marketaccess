import { useState } from 'react';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './Sidebar.css';

function Sidebar({ currentSection, onSectionChange }) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const mainNavItems = [
    { id: 'home', icon: 'bi-house-door', label: 'Home', badge: null, url: 'https://kumii.africa' },
    { id: 'activity', icon: 'bi-activity', label: 'Activity', badge: 3, url: 'https://kumii.africa/activity' },
    { id: 'messages', icon: 'bi-chat', label: 'Messages', badge: null, url: 'https://kumii.africa/messaging' },
    { id: 'calendar', icon: 'bi-calendar', label: 'Calendar', badge: null, url: 'https://kumii.africa/calendar' },
    { id: 'calls', icon: 'bi-telephone', label: 'Calls', badge: null, url: 'https://kumii.africa/calendar' },
    { id: 'files', icon: 'bi-folder', label: 'Files', badge: null, url: 'https://kumii.africa/files' },
    { id: 'briefcase', icon: 'bi-briefcase', label: 'Briefcase', badge: null, url: 'hhttps://kumii.africa/copilot' },
    { id: 'apps', icon: 'bi-grid-3x3-gap', label: 'Apps', badge: null, highlight: true, url: 'https://kumii.africa/edit-profile' },
    { id: 'support', icon: 'bi-three-dots', label: 'More', badge: null, url: 'https://kumii.africa/edit-profile' },
  ];

  const gatewayItems = [
    { id: 'capital', icon: 'bi-graph-up-arrow', label: 'Access To Capital', active: false, url: 'https://kumii.africa/funding' },
    { id: 'market', icon: 'bi-graph-up-arrow', label: 'Access To Market', active: true, url: null }, // Current page, no external link
    { id: 'advisory', icon: 'bi-graph-up-arrow', label: 'Expert Advisory', active: false, url: 'https://kumii.africa/find-advisor' },
    { id: 'mentorship', icon: 'bi-graph-up-arrow', label: 'Mentorship', active: false, url: 'https://kumii.africa/mentorship' },
    { id: 'tools', icon: 'bi-graph-up-arrow', label: 'Business Tools', active: false, url: 'https://kumii.africa/services/category/software-services' },
    { id: 'resources', icon: 'bi-graph-up-arrow', label: 'Resources Hub', active: false, url: 'https://kumii.africa/resources' },
  ];

  const marketTools = [
    { id: 'government-tenders', label: 'Government Tenders' },
    { id: 'private-tenders', label: 'Private Sector Tenders' },
  ];

  return (
    <aside className="sidebar">
      {/* Top Section - Main Navigation */}
      <div className="sidebar-top">
        {/* Main Navigation */}
        <nav className="sidebar-nav">
          {mainNavItems.map(item => (
            <a
              key={item.id}
              href={item.url}
              className={`nav-item ${currentSection === item.id ? 'active' : ''} ${item.highlight ? 'highlight' : ''}`}
              target="_blank"
              rel="noopener noreferrer"
              title={item.label}
            >
              <i className={`bi ${item.icon} nav-icon`}></i>
              {item.badge && (
                <span className="nav-badge">{item.badge}</span>
              )}
            </a>
          ))}
          
          <button 
            className="nav-item more-btn"
            onClick={() => setShowMoreMenu(!showMoreMenu)}
            title="More"
          >
            <i className="bi bi-three-dots nav-icon"></i>
          </button>
        </nav>

        {/* User Profile */}
        <div className="sidebar-footer">
          <button className="user-profile" title="User Profile">
            <span className="user-avatar">U</span>
          </button>
        </div>
      </div>

      {/* Bottom Section - Content Panel */}
      <div className="sidebar-content shadow-lg">
        {/* Search Bar */}
        <div className="sidebar-search">
          <i className="bi bi-search search-icon"></i>
          <input 
            type="text" 
            placeholder="Search apps and more" 
            className="search-input"
          />
        </div>

        {/* Growth Gateway Section */}
        <div className="sidebar-section">
          <h3 className="section-title">Growth Gateway</h3>
          
          {gatewayItems.map(item => (
            item.url ? (
              <a
                key={item.id}
                href={item.url}
                className={`gateway-item ${item.active ? 'active' : ''}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="gateway-icon">
                  <i className={`bi ${item.icon}`}></i>
                </span>
                <span className="gateway-label">{item.label}</span>
              </a>
            ) : (
              <button
                key={item.id}
                className={`gateway-item ${item.active ? 'active' : ''}`}
                onClick={() => onSectionChange(item.id)}
              >
                <span className="gateway-icon">
                  <i className={`bi ${item.icon}`}></i>
                </span>
                <span className="gateway-label">{item.label}</span>
              </button>
            )
          ))}
        </div>

        {/* Access To Market Tools */}
        <div className="sidebar-section market-tools">
          <h3 className="section-title">Access To Market</h3>
          
          {marketTools.map(tool => (
            <button
              key={tool.id}
              className="tool-item"
              onClick={() => onSectionChange(tool.id)}
            >
              <span className="tool-label">{tool.label}</span>
            </button>
          ))}
          
          <button 
            className="more-dropdown"
            onClick={() => setShowMoreMenu(!showMoreMenu)} style={{ display: 'none' }}
          >
            <span>More</span>
            <i className="bi bi-chevron-down dropdown-icon"></i>
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
