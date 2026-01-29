import { useState } from 'react';
import './Sidebar.css';

function Sidebar({ currentSection, onSectionChange }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const mainNavItems = [
    { id: 'home', icon: '🏠', label: 'Home', badge: null },
    { id: 'activity', icon: '📊', label: 'Activity', badge: 3 },
    { id: 'messages', icon: '💬', label: 'Messages', badge: null },
    { id: 'calendar', icon: '📅', label: 'Calendar', badge: null },
    { id: 'calls', icon: '📞', label: 'Calls', badge: null },
    { id: 'files', icon: '📁', label: 'Files', badge: null },
    { id: 'briefcase', icon: '💼', label: 'Briefcase', badge: null },
    { id: 'apps', icon: '📱', label: 'Apps', badge: null },
    { id: 'support', icon: '🎧', label: 'Support', badge: null },
  ];

  const gatewayItems = [
    { id: 'capital', icon: '📈', label: 'Access To Capital', active: false },
    { id: 'market', icon: '📈', label: 'Access To Market', active: true },
    { id: 'advisory', icon: '📈', label: 'Expert Advisory', active: false },
    { id: 'mentorship', icon: '📈', label: 'Mentorship', active: false },
    { id: 'tools', icon: '📈', label: 'Business Tools', active: false },
    { id: 'resources', icon: '📈', label: 'Resources Hub', active: false },
  ];

  const marketTools = [
    { id: 'credit-check', label: 'Credit Score Check' },
    { id: 'document-generator', label: 'Document Generator' },
    { id: 'financial-model', label: 'Financial Model Builder' },
    { id: 'valuation', label: 'Universal Valuation Model' },
    { id: 'matching', label: 'Smart Matching' },
  ];

  return (
    <aside className={`sidebar ${isExpanded ? 'expanded' : ''}`}>
      {/* Search Bar */}
      <div className="sidebar-search">
        <span className="search-icon">🔍</span>
        <input 
          type="text" 
          placeholder="Search apps and more" 
          className="search-input"
        />
      </div>

      {/* Main Navigation */}
      <nav className="sidebar-nav">
        {mainNavItems.map(item => (
          <button
            key={item.id}
            className={`nav-item ${currentSection === item.id ? 'active' : ''}`}
            onClick={() => onSectionChange(item.id)}
            title={item.label}
          >
            <span className="nav-icon">{item.icon}</span>
            {isExpanded && <span className="nav-label">{item.label}</span>}
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
          <span className="nav-icon">⋯</span>
          {isExpanded && <span className="nav-label">More</span>}
        </button>
      </nav>

      {/* Growth Gateway Section */}
      <div className="sidebar-section">
        <h3 className="section-title">Growth Gateway</h3>
        
        {gatewayItems.map(item => (
          <button
            key={item.id}
            className={`gateway-item ${item.active ? 'active' : ''}`}
            onClick={() => onSectionChange(item.id)}
          >
            <span className="gateway-icon">{item.icon}</span>
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
          <span className="dropdown-icon">▼</span>
        </button>
      </div>

      {/* User Profile */}
      <div className="sidebar-footer">
        <button className="user-profile" title="User Profile">
          <span className="user-avatar">KM</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
