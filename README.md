# Market Access - South African Tenders Portal

A production-ready React web application that fetches and displays South African tenders from the National Treasury eTenders OCDS Releases API.

## Features

- 🔍 **Search & Filter**: Real-time search functionality to find relevant tenders
- 📱 **Responsive Design**: Mobile-first responsive card gallery layout
- 🚀 **Fast Performance**: Built with Vite for optimal build times and hot module replacement
- 🎨 **Modern UX**: Clean, intuitive interface with smooth interactions
- 🔗 **Direct Application**: One-click access to official tender documents
- 📊 **Pagination**: Efficient browsing through large datasets
- ⚡ **Error Handling**: Robust error handling with retry functionality
- 🌐 **API Proxy**: Express backend to handle API requests efficiently
- 📝 **Private Tenders**: Add and manage private sector tender opportunities
- ☁️ **Cloud Storage**: Supabase integration for persistent data storage
- 🔄 **Auto-Sync**: Automatic sync between localStorage and cloud database

## Tech Stack

### Frontend
- **React 19** - UI framework
- **Vite 7** - Build tool and dev server
- **Axios** - HTTP client
- **Supabase** - Backend-as-a-Service for data storage
- **CSS3** - Styling with modern features

### Backend
- **Node.js** - Runtime environment
- **Express 5** - Web server framework
- **CORS** - Cross-origin resource sharing
- **Supabase** - PostgreSQL database and API

## Project Structure

```
marketaccess/
├── src/
│   ├── components/        # React components
│   │   ├── TenderCard.jsx
│   │   ├── FilterBar.jsx
│   │   ├── LoadingSpinner.jsx
│   │   ├── ErrorMessage.jsx
│   │   └── Pagination.jsx
│   ├── lib/              # Utility functions and API services
│   │   └── api.js
│   ├── App.jsx           # Main application component
│   ├── App.css
│   ├── index.css
│   └── main.jsx
├── server/
│   └── index.js          # Express backend server
├── public/
├── package.json
└── vite.config.js
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm installed
- Internet connection to access the National Treasury eTenders API
- Supabase account (free tier) for private tenders feature

### Installation

1. Clone the repository:
```bash
git clone https://github.com/kumii-dev/marketaccess.git
cd marketaccess
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` and add your Supabase credentials (see [SUPABASE-SETUP.md](./SUPABASE-SETUP.md) for details):
```bash
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key-here
```

4. Set up Supabase database (first time only):
   - Follow the guide in [SUPABASE-SETUP.md](./SUPABASE-SETUP.md)
   - Run the SQL schema in your Supabase project

### Running the Application

The application requires both the backend server and frontend to be running.

#### Development Mode

1. Start the Express backend server (in one terminal):
```bash
npm run server
```
The server will run on `http://localhost:3001`

2. Start the Vite dev server (in another terminal):
```bash
npm run dev
```
The frontend will run on `http://localhost:5174`

3. Open your browser and navigate to `http://localhost:5174`

#### Production Build

1. Build the frontend:
```bash
npm run build
```

2. Preview the production build:
```bash
npm run preview
```

## API Integration

The application integrates with the **National Treasury eTenders OCDS Releases API**:
- Base URL: `https://ocds-api.etenders.gov.za/api/OCDSReleases`
- API Standard: Open Contracting Data Standard (OCDS)

### API Endpoints

- `GET /api/tenders` - Fetch tenders with pagination and search
  - Query Parameters:
    - `page` - Page number (default: 1)
    - `limit` - Items per page (default: 20)
    - `search` - Search query string

- `GET /api/health` - Health check endpoint

## Features in Detail

### Tender Cards
Each tender card displays:
- Tender title and OCID (Open Contracting ID)
- Buyer organization name
- Tender value (if available)
- Start and end dates
- Description
- "Apply Now" button to access tender documents

### Search Functionality
- Real-time search across tender data
- Responsive search input with clear button
- Search results update pagination automatically

### Pagination
- Smart pagination with ellipsis for large datasets
- Previous/Next navigation
- Direct page number access
- Smooth scroll to top on page change

### Responsive Design
- Mobile-first approach
- Flexible grid layout
- Touch-friendly interface
- Optimized for various screen sizes

## Environment Variables

Create a `.env` file in the root directory:

```env
# Backend server port
PORT=3001

# Frontend API URL (for production)
VITE_API_BASE_URL=http://localhost:3001

# Use mock data for demonstration (set to 'true' to use mock data)
# Useful for development/testing when the external API is not accessible
VITE_USE_MOCK_DATA=false
```

**Note**: The application includes mock tender data for demonstration purposes. Set `VITE_USE_MOCK_DATA=true` in your `.env` file to use mock data instead of the live API. This is useful for development, testing, or when the National Treasury API is unavailable.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License.

## Acknowledgments

- Data provided by [National Treasury eTenders](https://www.etenders.gov.za/)
- Built with [Vite](https://vitejs.dev/) and [React](https://react.dev/)
- API follows [Open Contracting Data Standard (OCDS)](https://www.open-contracting.org/)

## Support

For issues, questions, or contributions, please open an issue in the GitHub repository.
# Force deployment
