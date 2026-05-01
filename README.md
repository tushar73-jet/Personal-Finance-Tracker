# Personal Finance Tracker

A comprehensive tool to manage and analyze your financial health. Built with Node.js, Express, and PostgreSQL.

## Features
- User Authentication (JWT & Google OAuth)
- Income, Expense, and Investment tracking
- Categorization and Budgeting
- Dashboard with financial overview
- Receipt Uploading
- Multi-currency support
- Email Notifications for budget overruns

## Local Setup
1. Clone the repository.
2. Install dependencies: `npm install`
3. Set up PostgreSQL and create the database using `database.sql`.
4. Create a `.env` file with the following:
   ```env
   PORT=3000
   DB_DATABASE=personal_finance
   JWT_SECRET=your_jwt_secret
   GOOGLE_CLIENT_ID=your_google_client_id
   GOOGLE_CLIENT_SECRET=your_google_client_secret
   EMAIL_HOST=smtp.ethereal.email
   EMAIL_USER=your_email_user
   EMAIL_PASS=your_email_pass
   ```
5. Run the server: `npm run dev`

## Deployment

### Using Render
This project includes a `render.yaml` file for easy deployment on Render.
1. Connect your GitHub repository to Render.
2. Render will automatically detect the `render.yaml` and set up the Web Service and PostgreSQL database.

### Using Docker
1. Build the image: `docker build -t personal-finance-tracker .`
2. Run the container: `docker run -p 3000:3000 personal-finance-tracker`