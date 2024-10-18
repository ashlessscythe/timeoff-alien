# 🚀 TimeOff.Management

📅 Web application for managing employee absences with style!

<a href="https://travis-ci.org/timeoff-management/timeoff-management-application"><img align="right" src="https://travis-ci.org/timeoff-management/timeoff-management-application.svg?branch=master" alt="Build status" /></a>

## ✨ Features

### 🆕 New Features

- 🎨 Theme selector: Customize your TimeOff.Management experience!
- 📊 Faster leaves report: Get insights quicker than ever!
- 📅 Date of request added to leaves table under calendar
- 🌱 Optimized seed script for better performance
- 🔧 Cloudflare scripts fix for improved reliability

### Existing Features

- 👥 Multiple views of staff absences: Calendar view, Team view, or Just plain list
- ⚙️ Customizable to fit your company policy
- 🔗 Third Party Calendar Integration
- 🔄 Three Steps Workflow
- 🔒 Access control with different user types
- 📊 Data extraction to CSV
- 📱 Mobile-friendly design
- 💡 Many other convenient features

## 🛠️ Installation

### ☁️ Cloud hosting

Visit http://timeoff.management/ and create a company account to use the cloud-based version.

### 🏠 Self hosting

```bash
# Clone the repository
git clone https://github.com/timeoff-management/application.git timeoff-management
cd timeoff-management
```

#### Standalone

```bash
npm install
npm start
```

#### 🐳 Using Docker

```bash
# Pull the image
docker pull aliengen/timeoff-management-application:master

# Run the container
docker run -d -p 3000:3000 --env-file ./env --name timeoff aliengen/timeoff-management-application:master
```

#### 🐳 Using Docker-compose

```bash
docker-compose up
```

## ⚙️ Configuration

Configuration can be done through environment variables or JSON configuration files.

### 🔑 Environment Variables

Here's a summary of key environment variables you can set:

- `BRANDING_URI`: URL of the TimeOff.Management application
- `BRANDING_WEBSITE`: URL of your company's website
- `HEADER_TITLE`: Custom header title for the application
- `DATABASE_URL`: Full database URL (for external databases)
- `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_HOST`: Database configuration (for local databases)
- `DB_DIALECT`: Database type (mysql, postgres, sqlite, mssql)
- `OPTION_ALLOW_NEW_REGISTRATIONS`: Set to true to allow new company registrations
- `SMTP_*`: Various SMTP settings for email configuration
- `CRYPTO_SECRET`: Secret key for password hashing
- `SESSION_SECRET`: Secret key for session management

For a complete list of options, refer to the `.env.example` file in the project root.

## 🧪 Run tests

```bash
USE_CHROME=1 npm test
```

## 🔄 Updating existing instance

```bash
git fetch
git pull origin master
npm install
npm run-script db-update
npm start
```

## 🎨 Customization

- Extend colors for leave types
- Configure locale-sensitive sorting
- Force explicit leave type selection

## 📣 Feedback

Please report any issues or feedback to <a href="https://twitter.com/FreeTimeOffApp">Twitter</a> or Email: pavlo at timeoff.management

Happy time off management! 🌴🏖️
