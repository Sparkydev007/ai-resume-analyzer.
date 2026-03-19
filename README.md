# Resume Analyzer

AI-powered resume feedback and ATS scoring built with React, React Router v7, Tailwind CSS, TypeScript, and Puter.js (client-side auth/storage/AI).

## Features

- Upload a resume (PDF)
- Provide target job title + description
- Get ATS score + detailed improvement tips
- Save and revisit past analyses

## Quick start (local)

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (Vite may use `5174` if `5173` is busy).

## Make it your own (recommended)

### 1) Change the branding

Edit:

- `constants/branding.ts`

### 2) Rename the package / repo

Edit:

- `package.json` → `"name"`

### 3) Publish as your own GitHub project

If you cloned from someone else, create a fresh git history:

```bash
rd /s /q .git
git init
git add .
git commit -m "Initial commit"
```

Then create a new GitHub repo and push it.

## Notes

- This app uses Puter.js via a script tag in `app/root.tsx`.
