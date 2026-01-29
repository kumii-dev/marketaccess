import { useState } from 'react';
import 'bootstrap-icons/font/bootstrap-icons.css';
import './Sidebar.css';

function Sidebar({ currentSection, onSectionChange }) {
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const mainNavItems = [
    { id: 'home', icon: 'bi-house-door', label: 'Home', badge: null },
    { id: 'activity', icon: 'bi-activity', label: 'Activity', badge: 3 },
    { id: 'messages', icon: 'bi-chat-dots', label: 'Messages', badge: null },
    { id: 'calendar', icon: 'bi-calendar3', label: 'Calendar', badge: null },
    { id: 'calls', icon: 'bi-telephone', label: 'Calls', badge: null },
    { id: 'files', icon: 'bi-folder', label: 'Files', badge: null },
    { id: 'briefcase', icon: 'bi-briefcase', label: 'Briefcase', badge: null },
    { id: 'apps', icon: 'bi-grid-3x3', label: 'Apps', badge: null, highlight: true },
    { id: 'support', icon: 'bi-headset', label: 'Support', badge: null },
  ];

  const gatewayItems = [
    { id: 'capital', icon: 'bi-graph-up-arrow', label: 'Access To Capital', active: false },
    { id: 'market', icon: 'bi-graph-up-arrow', label: 'Access To Market', active: true },
    { id: 'advisory', icon: 'bi-graph-up-arrow', label: 'Expert Advisory', active: false },
    { id: 'mentorship', icon: 'bi-graph-up-arrow', label: 'Mentorship', active: false },
    { id: 'tools', icon: 'bi-graph-up-arrow', label: 'Business Tools', active: false },
    { id: 'resources', icon: 'bi-graph-up-arrow', label: 'Resources Hub', active: false },
  ];

  const marketTools = [
    { id: 'credit-check', label: 'Credit Score Check' },
    { id: 'document-generator', label: 'Document Generator' },
    { id: 'financial-model', label: 'Financial Model Builder' },
    { id: 'valuation', label: 'Universal Valuation Model' },
    { id: 'matching', label: 'Smart Matching' },
  ];

  return (
    <aside className="sidebar">
      {/* Top Section - Main Navigation */}
      <div className="sidebar-top">
        {/* Main Navigation */}
        <nav className="sidebar-nav">
          {mainNavItems.map(item => (
            <button
              key={item.id}
              className={`nav-item ${currentSection === item.id ? 'active' : ''} ${item.highlight ? 'highlight' : ''}`}
              onClick={() => onSectionChange(item.id)}
              title={item.label}
            >
              <i className={`bi ${item.icon} nav-icon`}></i>
              {item.badge && (
                <span className="nav-badge">{item.badge}</span>
              )}
            </button>
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
            <span className="user-avatar">KM</span>
          </button>
        </div>
      </div>

      {/* Bottom Section - Content Panel */}
      <div className="sidebar-content">
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
            onClick={() => setShowMoreMenu(!showMoreMenu)}
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
