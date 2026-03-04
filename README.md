# Fix Plus Auto Care Center - Billing System

A digital billing system for Fix Plus Auto Care Center that generates professional PDF invoices matching your existing bill format. Works completely offline on Windows.

## Features

- Professional billing interface
- Automatic bill numbering
- Add multiple items/services
- Automatic GST calculation (SGST 9% + CGST 9%)
- Amount to words conversion
- PDF generation matching your original bill format
- Saves PDFs to local folder
- Works completely offline
- No internet required

## Prerequisites

Before running the application, you need to install:

1. **Node.js** (Version 16 or higher)
   - Download from: https://nodejs.org/
   - Choose the LTS (Long Term Support) version
   - During installation, make sure to check "Add to PATH"

## Installation Steps

### Step 1: Open Command Prompt

1. Press `Windows Key + R`
2. Type `cmd` and press Enter

### Step 2: Navigate to Project Folder

```bash
cd "C:\Users\YourUsername\Downloads\fixplus\project bill"
```

Replace `YourUsername` with your actual Windows username, or use the actual path where you saved this project.

### Step 3: Install Dependencies

```bash
npm install
```

This will download all required packages. It may take a few minutes.

### Step 4: Run the Application

```bash
npm start
```

The application window will open automatically.

## How to Use

### Creating a Bill

1. **Bill Number**: Auto-increments with each bill. You can modify if needed.

2. **Date**: Today's date is filled automatically. You can change it.

3. **Customer Details**:
   - Enter customer name
   - Enter phone number
   - Enter vehicle make (e.g., "Maruti Suzuki Swift")
   - Enter vehicle number

4. **Add Items/Services**:
   - Fill in the first row with item description, quantity, and amount
   - Click "+ Add Item" to add more rows
   - Click "Remove" to delete a row (minimum 1 row required)

5. **Automatic Calculations**:
   - Basic amount, SGST, CGST, and Total are calculated automatically
   - Amount in words is generated automatically

6. **Generate PDF**:
   - Click "Generate PDF" button
   - PDF will be saved in the `generated_bills` folder
   - Bill number will auto-increment for the next bill
   - Form will be cleared automatically

7. **View Generated Bills**:
   - Click "Open Bills Folder" button at the top
   - Or navigate to: `project bill/generated_bills/`

### Other Features

- **Clear Form**: Resets all fields (bill number remains unchanged)
- **Remove Item**: Removes an item row from the bill

## Bill Format

The generated PDF includes:

- Company header (FIX PLUS AUTO CARE CENTER)
- GSTIN: 29CGBPM0738G1ZF
- Contact numbers: 94488 07237, 77957 40356
- Address: C-8, SRI MAHADESHWARA COLLEGE ROAD,KOLLEGALA-571440
- Bill number and date
- Customer and vehicle details
- Itemized list with quantities and amounts
- SGST 9% and CGST 9%
- Total amount
- Amount in words
- Signature line

## File Structure

```
project bill/
├── package.json          # Project configuration
├── main.js              # Electron main process
├── index.html           # Application UI
├── styles.css           # Styling
├── renderer.js          # Application logic
├── bill_config.json     # Stores last bill number (auto-created)
├── generated_bills/     # PDF output folder
└── README.md           # This file
```

## Building Standalone Executable (Optional)

To create a Windows .exe file that can run without installing Node.js:

```bash
npm run build
```

The executable will be created in the `dist` folder. You can copy this .exe file to any Windows computer and run it without any installation.

## Troubleshooting

### Application doesn't start

1. Make sure Node.js is installed: Open cmd and type `node --version`
2. Make sure you ran `npm install` first
3. Try deleting `node_modules` folder and running `npm install` again

### PDF not generating

1. Check if `generated_bills` folder exists
2. Make sure you filled all required fields
3. Check the notification message for specific error

### Bill number not incrementing

1. Check if `bill_config.json` file exists
2. If it doesn't exist, it will be created automatically
3. You can manually edit this file to change the starting bill number

## Customization

### Changing Starting Bill Number

Edit the `bill_config.json` file (will be created after first bill):

```json
{
  "lastBillNumber": 185
}
```

Change `185` to your desired starting number minus 1.

### Changing Company Details

Edit the PDF generation section in `renderer.js` (lines 212-232) to update:
- GSTIN number
- Phone numbers
- Address
- Company name

### Changing GST Rates

Edit `renderer.js`, function `calculateTotals()` (around line 82):

```javascript
const sgst = basicAmount * 0.09;  // Change 0.09 to your rate
const cgst = basicAmount * 0.09;  // Change 0.09 to your rate
```

## Support

If you encounter any issues:

1. Make sure all files are in the same folder
2. Check that Node.js is properly installed
3. Try running `npm install` again
4. Restart your computer and try again

## Backup

The `generated_bills` folder contains all your PDFs. Make sure to backup this folder regularly.

## Version

Version: 1.0.0

---

**Fix Plus Auto Care Center**
C-8, SRI MAHADESHWARA COLLEGE ROAD,KOLLEGALA-571440
Contact: 94488 07237, 77957 40356
