# Stack62 Frontend

A premium AI-native business operating platform frontend built with React, TypeScript, and Tailwind CSS.

## Overview

Stack62 is designed as a modular, intelligent business operating system that allows organizations to create, manage, and evolve internal business systems through AI-powered workflows and structured interfaces.

## Key Features

### 🏠 Landing Dashboard
- Quick stats overview (active systems, pending tasks, completed items)
- System cards with real-time metrics
- AI-powered suggestions for workflow improvements
- Task management and activity feed
- Recent activity timeline

### 🚀 System Creation Flow
- Three creation modes:
  - **Template Selection**: Pre-built templates for HR, Finance, Procurement, Projects, etc.
  - **From Scratch**: Custom system builder with industry selection
  - **AI Generation**: Natural language system creation via prompts
- Visual module preview before creation

### 📊 System Dashboard
- Key performance metrics with trend indicators
- Module grid view with status badges
- Interactive charts (line charts, pie charts) using Recharts
- AI-generated insights and recommendations
- Pending approvals section
- Real-time activity log

### 📋 Module View (Data Tables)
- Searchable and filterable data tables
- Bulk selection and actions
- Column customization
- Status badges and quick actions
- AI summarization capabilities
- Export functionality
- Pagination support

### 📝 Record Detail Pages
- Comprehensive employee/record profiles
- Tabbed interface (Overview, History, Performance, Documents, Activity)
- AI-generated summaries and insights
- Related records and timeline
- Quick edit actions

### ⚙️ Workflow Builder
- Visual step-by-step workflow creation
- Conditional branching logic
- Action triggers (approvals, notifications, updates)
- AI optimization suggestions
- Workflow performance metrics

### 🤖 AI Assistant Panel
- Context-aware side panel
- Natural language interactions
- Quick action suggestions
- System understanding (current system, module, record)
- Conversation history

### ⚙️ Settings
- Workspace management
- Team member invitations
- Role-based permissions
- Notification preferences
- Security settings (2FA, sessions)
- Billing and subscription management

## Design System

### Color Palette
- **Primary**: Indigo (600-800) - Professional and trustworthy
- **Neutrals**: Slate (50-900) - Clean and modern
- **Status Colors**: 
  - Green (success/active)
  - Orange (warning/pending)
  - Red (error/attention needed)
  - Blue (info)
  - Purple (workflow/automation)

### Typography
- Clean sans-serif (system fonts)
- Strong hierarchy with semantic headings
- Comfortable reading sizes

### Spacing & Layout
- Generous padding and margins
- Maximum width containers (7xl: ~1280px)
- Responsive grid layouts
- Card-based content organization

### Components Used
- Buttons (primary, outline, ghost variants)
- Cards with headers and content sections
- Tables with sorting and filtering
- Modals/Dialogs for system creation
- Side Sheets for AI assistant
- Badges for status indicators
- Tabs for navigation
- Dropdown menus
- Form inputs (text, textarea, select, switch)

## Navigation Structure

### Global Sidebar
- Home
- Systems
- Templates
- Tasks
- Approvals
- Reports
- AI Studio
- Activity
- Settings

### Top Bar
- Command palette (search)
- Quick create actions
- AI assistant toggle
- Notifications
- User profile menu

## Tech Stack

- **Framework**: React 18.3
- **Routing**: React Router 7 (Data Mode)
- **Styling**: Tailwind CSS 4
- **UI Components**: Radix UI primitives
- **Charts**: Recharts
- **Icons**: Lucide React
- **Animations**: Motion (Framer Motion)

## File Structure

```
/src/app/
├── App.tsx                      # Main app entry with RouterProvider
├── routes.tsx                   # Router configuration
├── components/
│   ├── Shell.tsx                # Global layout shell with sidebar
│   ├── CreateSystemDialog.tsx   # System creation modal
│   └── AIAssistant.tsx          # AI assistant side panel
└── pages/
    ├── Home.tsx                 # Landing dashboard
    ├── SystemDashboard.tsx      # Individual system view
    ├── ModuleView.tsx           # Data table view
    ├── RecordDetail.tsx         # Individual record detail
    ├── WorkflowBuilder.tsx      # Visual workflow editor
    └── Settings.tsx             # Settings pages
```

## Design Principles

1. **Clarity**: Interface is always understandable, even with complex features
2. **Modularity**: Every section feels like an independent, reusable module
3. **Intelligence**: AI is embedded naturally into workflows, not siloed
4. **Professionalism**: Enterprise-grade visual language
5. **Scalability**: Works for startups, schools, hospitals, and enterprises
6. **Speed**: Minimal, focused interface
7. **Guided Complexity**: Progressive disclosure of advanced features

## Key UX Patterns

- **Empty States**: Helpful prompts and suggestions when no data exists
- **Loading States**: Smooth transitions and loading indicators
- **Error Handling**: Clear error messages with context
- **Confirmation Dialogs**: Destructive actions require confirmation
- **Contextual Actions**: Actions appear based on user context
- **Responsive Design**: Desktop-first, tablet and mobile adapted

## User Personas

1. **Super Admin**: Creates and manages systems, users, and workflows
2. **Department Admin**: Manages specific systems or departments
3. **Staff User**: Uses assigned workflows and views required tools
4. **Executive/Manager**: Reviews dashboards, reports, and approvals
5. **External Collaborator**: Limited access to shared areas

## Future Enhancements

- Drag-and-drop dashboard customization
- Real-time collaboration features
- Advanced analytics and reporting
- Mobile native apps
- Offline mode support
- Custom theming and branding
- API integrations
- Advanced workflow automation

## Notes

This is a frontend prototype demonstrating the UI/UX design of Stack62. Backend integration points are prepared but not fully implemented. The design emphasizes:

- Premium, modern aesthetics
- AI-native interaction patterns
- Modular, scalable architecture
- Enterprise-grade professionalism
- Intuitive user experience across all skill levels
