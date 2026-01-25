// Mock tender data for demonstration purposes
export const mockTenders = [
  {
    ocid: "ocds-h6vhtk-001",
    tender: {
      id: "TND001",
      title: "Supply and Delivery of Medical Equipment",
      description: "Request for proposals for the supply, delivery, and installation of advanced medical equipment for public hospitals across Gauteng Province. Equipment includes MRI machines, CT scanners, and diagnostic tools.",
      status: "active",
      value: {
        amount: 15000000,
        currency: "ZAR"
      },
      tenderPeriod: {
        startDate: "2026-01-15T00:00:00Z",
        endDate: "2026-02-28T23:59:59Z"
      },
      documents: [
        {
          id: "doc001",
          documentType: "tenderNotice",
          title: "Tender Notice",
          url: "https://www.etenders.gov.za/tender/TND001"
        }
      ]
    },
    buyer: {
      name: "Gauteng Department of Health",
      id: "ZA-CPA-GDOH"
    }
  },
  {
    ocid: "ocds-h6vhtk-002",
    tender: {
      id: "TND002",
      title: "Construction of Rural Road Infrastructure",
      description: "Tender for the construction and upgrading of rural road infrastructure connecting farming communities in KwaZulu-Natal. Includes bridges, drainage systems, and road surfacing.",
      status: "active",
      value: {
        amount: 85000000,
        currency: "ZAR"
      },
      tenderPeriod: {
        startDate: "2026-01-10T00:00:00Z",
        endDate: "2026-03-15T23:59:59Z"
      },
      documents: [
        {
          id: "doc002",
          documentType: "biddingDocuments",
          title: "Bidding Documents",
          url: "https://www.etenders.gov.za/tender/TND002"
        }
      ]
    },
    buyer: {
      name: "KwaZulu-Natal Department of Transport",
      id: "ZA-CPA-KZNDOT"
    }
  },
  {
    ocid: "ocds-h6vhtk-003",
    tender: {
      id: "TND003",
      title: "IT Services and Software Development",
      description: "Request for proposals for comprehensive IT services including software development, system maintenance, cybersecurity, and technical support for government departments.",
      status: "active",
      value: {
        amount: 45000000,
        currency: "ZAR"
      },
      tenderPeriod: {
        startDate: "2026-01-20T00:00:00Z",
        endDate: "2026-02-20T23:59:59Z"
      },
      documents: [
        {
          id: "doc003",
          documentType: "tenderNotice",
          title: "Tender Notice",
          url: "https://www.etenders.gov.za/tender/TND003"
        }
      ]
    },
    buyer: {
      name: "State Information Technology Agency (SITA)",
      id: "ZA-CPA-SITA"
    }
  },
  {
    ocid: "ocds-h6vhtk-004",
    tender: {
      id: "TND004",
      title: "Renewable Energy Solar Farm Development",
      description: "Tender for the development, construction, and operation of a 50MW solar photovoltaic power generation facility in the Northern Cape Province. Includes grid connection and maintenance.",
      status: "active",
      value: {
        amount: 650000000,
        currency: "ZAR"
      },
      tenderPeriod: {
        startDate: "2026-01-05T00:00:00Z",
        endDate: "2026-04-30T23:59:59Z"
      },
      documents: [
        {
          id: "doc004",
          documentType: "biddingDocuments",
          title: "Bidding Documents",
          url: "https://www.etenders.gov.za/tender/TND004"
        }
      ]
    },
    buyer: {
      name: "Department of Mineral Resources and Energy",
      id: "ZA-CPA-DMRE"
    }
  },
  {
    ocid: "ocds-h6vhtk-005",
    tender: {
      id: "TND005",
      title: "School Furniture and Equipment Supply",
      description: "Supply and delivery of classroom furniture, laboratory equipment, and educational materials for newly constructed schools in the Eastern Cape Province.",
      status: "active",
      value: {
        amount: 28000000,
        currency: "ZAR"
      },
      tenderPeriod: {
        startDate: "2026-01-18T00:00:00Z",
        endDate: "2026-03-10T23:59:59Z"
      },
      documents: [
        {
          id: "doc005",
          documentType: "tenderNotice",
          title: "Tender Notice",
          url: "https://www.etenders.gov.za/tender/TND005"
        }
      ]
    },
    buyer: {
      name: "Eastern Cape Department of Education",
      id: "ZA-CPA-ECDOE"
    }
  },
  {
    ocid: "ocds-h6vhtk-006",
    tender: {
      id: "TND006",
      title: "Water Infrastructure Upgrade Project",
      description: "Comprehensive upgrade of water treatment facilities and distribution networks serving communities in the Free State. Includes pipeline replacement and pump station installation.",
      status: "active",
      value: {
        amount: 120000000,
        currency: "ZAR"
      },
      tenderPeriod: {
        startDate: "2026-01-12T00:00:00Z",
        endDate: "2026-03-25T23:59:59Z"
      },
      documents: [
        {
          id: "doc006",
          documentType: "biddingDocuments",
          title: "Bidding Documents",
          url: "https://www.etenders.gov.za/tender/TND006"
        }
      ]
    },
    buyer: {
      name: "Free State Department of Water and Sanitation",
      id: "ZA-CPA-FSDWS"
    }
  }
];
