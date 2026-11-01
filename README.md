# Job Scraper Web

Job Scraper Web is the control center for a lane-aware job search. Review canonical listings, filter by career lane, inspect scores and repost history, track applications, manage resumes, explore market insights, and tune the scraper without editing Python.

## Features

- **Dashboard Overview**: View key statistics like new jobs, applied jobs, top matches, and more on the homepage.
- **Job Listings**:
  - **New Jobs**: Browse recently scraped job opportunities.
  - **Applied Jobs**: Keep track of all jobs you've applied to.
  - **Top Matches**: View jobs that best match your profile and resume score.
- **Resume Management**:
  - View and edit customized resumes.
  - Upload and associate personalized resumes with job applications.
  - PDF viewer for resumes.
- **Job Details**: View detailed information for each job, including description and company details.
- **Status Updates**: Mark jobs as "applied" or indicate interest level (interested/not interested).
- **Pagination**: Efficiently navigate through large lists of jobs.
- **Responsive Design**: User-friendly interface across various devices.
- **Supabase Integration**: Utilizes Supabase for backend services and database management.
- **Scraper Control Center**: Configure lane queries, routing filters, Canada/USA/EEA coverage, lookback, limits, and processing switches from `/config`.
- **Membership-Aware Views**: Multi-lane filters return each canonical job once while displaying the qualifying lane's independent state.

## Scraper configuration

Each enabled lane displays independent resume readiness. `Resume ready` means an enabled `archetype_resume_profiles` row resolves to a base resume. `Scrape only · resume missing` is intentional: scraping remains enabled, while resume-dependent workers such as scoring and resume generation skip that lane. The lane migration safely seeds or refreshes `technology_delivery` from the latest existing `base_resume`; it does not invent profiles for other lanes.

The `/config` page manages the database-backed career lanes and scrape settings without application authentication. This is an intentional convenience for the current trusted-LAN deployment: anyone who can reach the web app can read and change scraper configuration. Keep the app behind a host firewall or reverse-proxy network allowlist, validate the public host at the proxy, and restore authentication before exposing it beyond the trusted LAN. Configuration writes reject cross-origin browser requests and require JSON, but network isolation remains the primary access boundary.

Database access uses server-only `JOB_DATA_API_URL` / `JOB_DATA_API_TOKEN`; the latter must retain the reviewed `job_web` permissions, not a source service-role token. `SUPABASE_SERVICE_ROLE_KEY` remains server-only and is used only for legacy Supabase Storage. See [database / Storage runtime configuration and cutover notes](DATA_STORAGE_CUTOVER.md) for the full consumer inventory and Node CA startup requirements.

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org/) (v15.3.1)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**:
  - [Lucide React](https://lucide.dev/) for icons
  - [React PDF](https://github.com/wojtekmaj/react-pdf) for PDF viewing
  - [React Markdown](https://github.com/remarkjs/react-markdown) for rendering markdown content
- **Backend/Database**: [Supabase](https://supabase.io/)
- **State Management**: React Hooks (useState, useEffect) and URL search params for component state.
- **Linting**: ESLint (via `next lint`)

## Getting Started

Use the backend setup below, then configure this app with the data API and the separate original Supabase Storage project. The `/config` page remains restricted by the trusted-LAN boundary.

### Quick start

```bash
npm install
npm run dev
```

Add these values to `.env.local` before starting:

```bash
JOB_DATA_API_URL=https://data.example.test
JOB_DATA_API_TOKEN=your-least-privileged-job-web-token
# Legacy Supabase project remains Storage-only:
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-legacy-storage-service-role-key
```

`SUPABASE_SERVICE_ROLE_KEY` is server-only. Never prefix it with `NEXT_PUBLIC_`. Apply `supabase/migrations` in order through the normal Supabase deployment workflow before opening `/config`.

### Backend Setup (Crucial Prerequisite)

**This frontend application relies on a separate backend for job scraping, scoring, resume generation, and database operations.**

1.  **Backend Repository**: The backend service is located at [Job Scraper](https://github.com/anandanair/job-scraper).
2.  **Fork and Setup**: You **MUST** first fork this backend repository and follow its setup instructions to get the database and backend services running.
3.  **Database**: The backend setup will create and manage the database required by this frontend application.

Once the backend is successfully set up and running, you can proceed with setting up this frontend application.

The lane migration preserves legacy `jobs.archetype` values and creates canonical `technology_delivery` memberships for existing `software_tpm` data. Establish a Supabase Auth browser session for an administrator before opening `/config`; this repository does not currently include a sign-in page, so the page displays setup guidance when authentication is missing.

### Verify locally

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

### Prerequisites

- Node.js (v20 or later recommended)
- npm or yarn
- A running instance of the backend service from [Job Scraper](https://github.com/anandanair/job-scraper).

### Installation

1.  **Clone the repository (if applicable):**

    ```bash
    git clone https://github.com/anandanair/jobs-scrapper-web
    cd jobs-scrapper-web
    ```

2.  **Install dependencies:**

    ```bash
    npm install
    # or
    # yarn install
    ```

3.  **Set up environment variables:**
    Create a `.env.local` file in the root of your project and add the necessary Supabase credentials:
    ```env
    JOB_DATA_API_URL=https://data.example.test
    JOB_DATA_API_TOKEN=your_job_web_data_token
    NEXT_PUBLIC_SUPABASE_URL=your_original_storage_supabase_url
    NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
    SUPABASE_SERVICE_ROLE_KEY=your_legacy_storage_service_role_key
    ```

### Running the Development Server

Once the dependencies are installed and environment variables are set up, you can run the development server:

```bash
npm run dev
# or
# yarn dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Available Scripts

In the project directory, you can run:

- `npm run dev`: Runs the app in development mode.
- `npm run build`: Builds the app for production.
- `npm run start`: Starts the production server.
- `npm run lint`: Lints the codebase using Next.js's built-in ESLint configuration.

## Project Structure

Here's a brief overview of the main directories:

- `public/`: Contains static assets like images and the PDF worker.
- `src/`: Contains the core application code.
  - `src/app/`: Next.js App Router directory.
    - `api/`: API route handlers.
    - `jobs/`: Routes related to job listings (new, applied, top-matches, individual job details, resume views/edits).
    - `profile/`: User profile page (structure suggests this, content not fully reviewed).
    - `layout.tsx`: Root layout for the application.
    - `page.tsx`: Homepage/dashboard.
    - `globals.css`: Global styles and Tailwind CSS setup.
  - `src/components/`: Reusable React components.
    - `jobs/`: Components specific to job listings and details.
    - `resume/`: Components for resume viewing and editing.
    - `CustomPdfViewer.tsx`: Component for displaying PDF files.
    - `Navbar.tsx`: Application navigation bar.
  - `src/lib/`:
    - `supabase/queries.ts`: Functions for interacting with the Supabase database.
  - `src/types.ts`: TypeScript type definitions for the application.
  - `src/utils/`:
    - `supabase/server.ts`: Supabase server client setup.
- `next.config.ts`: Next.js configuration file.
- `package.json`: Lists project dependencies and scripts.
- `tsconfig.json`: TypeScript configuration.

## Contributing

Contributions are welcome! Please follow the standard fork-and-pull-request workflow.

## License

This project is licensed under the MIT License. See the `LICENSE` file for more details.
# Lane-scoped job state

Job list rows filtered by one or more career lanes expose state from a single
qualifying `job_archetype_memberships` row, not the global compatibility fields
on `jobs`. For multi-lane filters, the projection deterministically prefers the
highest qualifying `match_score`, then `career_lane_definitions.sort_order`, then
`archetype`. The same row supplies `resume_score`, `resume_score_stage`, filter
state, customized resume, and displayed archetype. Detail URLs preserve global
`jobs` behavior unless an `archetype` query parameter is explicitly supplied.
