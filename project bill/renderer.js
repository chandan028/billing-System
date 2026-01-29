const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// Logo base64 (will be loaded from file)
let logoBase64 = null;

// Initialize bill number on load
window.addEventListener('DOMContentLoaded', async () => {
    // Load logo
    await loadLogo();

    // Get and set next bill number
    const lastBillNumber = await ipcRenderer.invoke('get-next-bill-number');
    document.getElementById('billNumber').value = lastBillNumber + 1;

    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('billDate').value = today;

    // Add event listeners
    setupEventListeners();
});

async function loadLogo() {
    try {
        const logoPath = path.join(__dirname, 'logo.png');
        if (fs.existsSync(logoPath)) {
            const logoData = fs.readFileSync(logoPath);
            logoBase64 = 'data:image/png;base64,' + logoData.toString('base64');
            console.log('Logo loaded successfully');
        } else {
            console.log('Logo file not found at:', logoPath);
        }
    } catch (error) {
        console.error('Error loading logo:', error);
    }
}

function setupEventListeners() {
    // Add item button
    document.getElementById('addItem').addEventListener('click', addItem);

    // Form submission
    document.getElementById('billingForm').addEventListener('submit', generatePDF);

    // Clear form
    document.getElementById('clearForm').addEventListener('click', clearForm);

    // Open folder
    document.getElementById('openFolder').addEventListener('click', openBillsFolder);

    // Calculate totals when items change
    document.getElementById('itemsBody').addEventListener('input', calculateTotals);

    // Phone number validation - only allow digits
    document.getElementById('customerPhone').addEventListener('input', function(e) {
        this.value = this.value.replace(/[^0-9]/g, '').substring(0, 10);
    });
}

function addItem() {
    const tbody = document.getElementById('itemsBody');
    const itemCount = tbody.querySelectorAll('.item-row').length + 1;

    const row = document.createElement('tr');
    row.className = 'item-row';
    row.innerHTML = `
        <td class="item-number">${itemCount}</td>
        <td><input type="text" class="item-particulars" placeholder="Item/Service description" required></td>
        <td><input type="number" class="item-qty" value="1" min="1" required></td>
        <td><input type="number" class="item-amount" placeholder="0.00" step="0.01" min="0" required></td>
        <td><button type="button" class="remove-btn" onclick="removeItem(this)">Remove</button></td>
    `;

    tbody.appendChild(row);
    updateItemNumbers();
}

function removeItem(button) {
    const tbody = document.getElementById('itemsBody');
    if (tbody.querySelectorAll('.item-row').length > 1) {
        button.closest('.item-row').remove();
        updateItemNumbers();
        calculateTotals();
    } else {
        showNotification('At least one item is required', 'error');
    }
}

function updateItemNumbers() {
    const rows = document.querySelectorAll('.item-row');
    rows.forEach((row, index) => {
        row.querySelector('.item-number').textContent = index + 1;
    });
}

function calculateTotals() {
    const rows = document.querySelectorAll('.item-row');
    let grandTotal = 0;

    // Sum all item amounts (amounts are GST inclusive)
    rows.forEach(row => {
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const amount = parseFloat(row.querySelector('.item-amount').value) || 0;
        grandTotal += qty * amount;
    });

    // Reverse calculate: Total includes 18% GST
    // Basic = Total / 1.18
    // SGST = Basic * 0.09
    // CGST = Basic * 0.09
    const basicAmount = grandTotal / 1.18;
    const sgst = basicAmount * 0.09;
    const cgst = basicAmount * 0.09;

    document.getElementById('grandTotal').value = grandTotal.toFixed(2);
    document.getElementById('basicAmount').value = basicAmount.toFixed(2);
    document.getElementById('sgst').value = sgst.toFixed(2);
    document.getElementById('cgst').value = cgst.toFixed(2);

    // Convert to words (use grand total for words)
    document.getElementById('amountInWords').value = numberToWords(Math.round(grandTotal));
}

function numberToWords(num) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    if (num === 0) return 'Zero Rupees Only';

    num = Math.floor(num);

    const crore = Math.floor(num / 10000000);
    num %= 10000000;
    const lakh = Math.floor(num / 100000);
    num %= 100000;
    const thousand = Math.floor(num / 1000);
    num %= 1000;
    const hundred = Math.floor(num / 100);
    num %= 100;
    const ten = Math.floor(num / 10);
    const one = Math.floor(num % 10);

    let words = '';

    if (crore > 0) {
        words += numberToWordsHelper(crore) + ' Crore ';
    }
    if (lakh > 0) {
        words += numberToWordsHelper(lakh) + ' Lakh ';
    }
    if (thousand > 0) {
        words += numberToWordsHelper(thousand) + ' Thousand ';
    }
    if (hundred > 0) {
        words += ones[hundred] + ' Hundred ';
    }
    if (ten > 1) {
        words += tens[ten] + ' ';
        if (one > 0) {
            words += ones[one] + ' ';
        }
    } else if (ten === 1) {
        words += teens[one] + ' ';
    } else if (one > 0) {
        words += ones[one] + ' ';
    }

    words += 'Rupees Only';

    return words.trim();
}

function numberToWordsHelper(num) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    if (num === 0) return '';
    if (num < 10) return ones[num];
    if (num < 20) return teens[num - 10];
    if (num < 100) {
        const ten = Math.floor(num / 10);
        const one = num % 10;
        return tens[ten] + (one > 0 ? ' ' + ones[one] : '');
    }
    return '';
}

async function generatePDF(e) {
    e.preventDefault();

    // Validate phone number
    const phone = document.getElementById('customerPhone').value;
    if (phone.length !== 10) {
        showNotification('Please enter a valid 10-digit phone number', 'error');
        return;
    }

    try {
        // Get form data
        const formData = {
            billType: document.getElementById('billType').value,
            billNumber: document.getElementById('billNumber').value,
            billDate: document.getElementById('billDate').value,
            customerName: document.getElementById('customerName').value,
            customerPhone: document.getElementById('customerPhone').value,
            vehicleMake: document.getElementById('vehicleMake').value,
            vehicleNumber: document.getElementById('vehicleNumber').value.toUpperCase(),
            basicAmount: document.getElementById('basicAmount').value,
            sgst: document.getElementById('sgst').value,
            cgst: document.getElementById('cgst').value,
            grandTotal: document.getElementById('grandTotal').value,
            amountInWords: document.getElementById('amountInWords').value
        };

        // Get items
        const items = [];
        const rows = document.querySelectorAll('.item-row');
        rows.forEach((row, index) => {
            items.push({
                no: index + 1,
                particulars: row.querySelector('.item-particulars').value,
                qty: row.querySelector('.item-qty').value,
                amount: row.querySelector('.item-amount').value
            });
        });

        // Generate PDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Set colors
        const green = [46, 204, 113];
        const darkGreen = [39, 174, 96];
        const lightGrey = [245, 245, 245];
        const grey = [200, 200, 200];

        // Add watermark logo if available
        if (logoBase64) {
            doc.saveGraphicsState();
            doc.setGState(new doc.GState({ opacity: 0.1 }));
            doc.addImage(logoBase64, 'PNG', 50, 100, 110, 110);
            doc.restoreGraphicsState();
        }

        // Header - Company Info
        doc.setFillColor(...green);
        doc.rect(10, 10, 190, 50, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.text('GSTIN: 29CGBPM0738G1ZF', 15, 18);

        // Bill Type (dynamic)
        doc.setFontSize(12);
        doc.setFont(undefined, 'bold');
        doc.text(formData.billType, 105, 18, { align: 'center' });

        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text('Mob: 94488 07237', 160, 18);
        doc.text('77957 40356', 167, 23);

        doc.setFontSize(20);
        doc.setFont(undefined, 'bold');
        doc.text('FIX PLUS AUTO CARE CENTER', 105, 33, { align: 'center' });

        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text('All Type Car Repair & Service | Road Side Assistance', 105, 40, { align: 'center' });
        doc.text('C-8, SRI MAHADESHWARA COLLEGE ROAD, KOLLEGALA-571440', 105, 47, { align: 'center' });

        // Bill Number and Date row
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text(`Bill No: ${formData.billNumber}`, 15, 68);
        doc.text(`Date: ${formatDate(formData.billDate)}`, 150, 68);

        // Customer & Vehicle Details - 2x2 Table with grey background
        const tableY = 73;
        const tableHeight = 24;
        const colWidth = 95;

        // Draw table background (light grey)
        doc.setFillColor(...lightGrey);
        doc.rect(10, tableY, 190, tableHeight, 'F');

        // Draw table borders
        doc.setDrawColor(...grey);
        doc.setLineWidth(0.3);
        // Outer border
        doc.rect(10, tableY, 190, tableHeight);
        // Vertical middle line
        doc.line(105, tableY, 105, tableY + tableHeight);
        // Horizontal middle line
        doc.line(10, tableY + 12, 200, tableY + 12);

        // Table content
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);

        // Row 1, Col 1 - Customer Name
        doc.setFont(undefined, 'normal');
        doc.text('Customer Name:', 13, tableY + 8);
        doc.setFont(undefined, 'bold');
        doc.text(formData.customerName, 50, tableY + 8);

        // Row 1, Col 2 - Phone
        doc.setFont(undefined, 'normal');
        doc.text('Phone:', 108, tableY + 8);
        doc.setFont(undefined, 'bold');
        doc.text(formData.customerPhone, 125, tableY + 8);

        // Row 2, Col 1 - Vehicle Make
        doc.setFont(undefined, 'normal');
        doc.text('Vehicle:', 13, tableY + 20);
        doc.setFont(undefined, 'bold');
        doc.text(formData.vehicleMake, 35, tableY + 20);

        // Row 2, Col 2 - Vehicle Number (BOLD)
        doc.setFont(undefined, 'normal');
        doc.text('Reg. No:', 108, tableY + 20);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(12);
        doc.text(formData.vehicleNumber, 130, tableY + 20);
        doc.setFontSize(10);

        // Items table
        const itemTableStartY = tableY + tableHeight + 5;

        // Table header
        doc.setFillColor(...green);
        doc.rect(10, itemTableStartY, 190, 10, 'FD');
        doc.setTextColor(255, 255, 255);
        doc.setFont(undefined, 'bold');
        doc.setFontSize(10);
        doc.text('No.', 15, itemTableStartY + 7);
        doc.text('Particulars', 30, itemTableStartY + 7);
        doc.text('Qty', 150, itemTableStartY + 7);
        doc.text('Amount', 175, itemTableStartY + 7);

        // Table rows
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, 'normal');
        let currentY = itemTableStartY + 10;

        items.forEach((item, index) => {
            if (currentY > 220) {
                doc.addPage();
                currentY = 20;
                // Re-add watermark on new page
                if (logoBase64) {
                    doc.saveGraphicsState();
                    doc.setGState(new doc.GState({ opacity: 0.1 }));
                    doc.addImage(logoBase64, 'PNG', 50, 80, 110, 110);
                    doc.restoreGraphicsState();
                }
            }

            // Alternate row background
            if (index % 2 === 0) {
                doc.setFillColor(250, 250, 250);
                doc.rect(10, currentY, 190, 10, 'F');
            }

            doc.setFontSize(10);
            doc.text(item.no.toString(), 17, currentY + 7);

            // Handle long text
            const particularsText = item.particulars;
            if (particularsText.length > 55) {
                doc.setFontSize(9);
                doc.text(particularsText.substring(0, 55) + '...', 30, currentY + 7);
                doc.setFontSize(10);
            } else {
                doc.text(particularsText, 30, currentY + 7);
            }

            doc.text(item.qty.toString(), 152, currentY + 7);
            doc.text(parseFloat(item.amount).toFixed(2), 175, currentY + 7);

            // Draw line
            doc.setDrawColor(...green);
            doc.setLineWidth(0.2);
            doc.line(10, currentY + 10, 200, currentY + 10);

            currentY += 10;
        });

        // Totals section
        const totalsY = currentY + 10;

        // Draw box for totals
        doc.setFillColor(...lightGrey);
        doc.rect(120, totalsY - 3, 75, 42, 'F');
        doc.setDrawColor(...green);
        doc.setLineWidth(0.5);
        doc.rect(120, totalsY - 3, 75, 42);

        doc.setFont(undefined, 'bold');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);

        doc.text('Basic:', 125, totalsY + 5);
        doc.text(formData.basicAmount, 190, totalsY + 5, { align: 'right' });

        doc.text('SGST 9%:', 125, totalsY + 13);
        doc.text(formData.sgst, 190, totalsY + 13, { align: 'right' });

        doc.text('CGST 9%:', 125, totalsY + 21);
        doc.text(formData.cgst, 190, totalsY + 21, { align: 'right' });

        // Draw line before total
        doc.setDrawColor(...darkGreen);
        doc.setLineWidth(1);
        doc.line(122, totalsY + 26, 193, totalsY + 26);

        doc.setFontSize(12);
        doc.setTextColor(...darkGreen);
        doc.text('Total:', 125, totalsY + 35);
        doc.text(formData.grandTotal, 190, totalsY + 35, { align: 'right' });

        // Amount in words
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text(`Received Rupees: ${formData.amountInWords}`, 15, totalsY + 48);

        // Signature
        doc.setFont(undefined, 'bold');
        doc.setFontSize(9);
        doc.text('For FIX PLUS AUTO CARE CENTER', 145, totalsY + 58);
        doc.setFont(undefined, 'normal');
        doc.line(145, totalsY + 72, 195, totalsY + 72);
        doc.text('Authorized Signature', 155, totalsY + 77);

        // Marketing Footer
        doc.setFillColor(...green);
        doc.rect(10, 275, 190, 15, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text('Thank You! Visit Again for Exciting Offers & Discounts!', 105, 283, { align: 'center' });
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        doc.text('Quality Service | Genuine Spare Parts | Customer Satisfaction Guaranteed', 105, 288, { align: 'center' });

        // Save PDF with new filename format: billnumber_vehiclenumber_date
        const pdfData = doc.output('datauristring');
        const vehicleNoClean = formData.vehicleNumber.replace(/[^a-zA-Z0-9]/g, '');
        const dateForFile = formatDate(formData.billDate).replace(/\//g, '-');
        const fileName = `${formData.billNumber}_${vehicleNoClean}_${dateForFile}.pdf`;

        const result = await ipcRenderer.invoke('save-pdf', { pdfData, fileName });

        if (result.success) {
            showNotification(`PDF saved: ${fileName}`);

            // Update bill number in config
            const currentBillNum = parseInt(formData.billNumber);
            await ipcRenderer.invoke('save-bill-number', currentBillNum);

            // Clear form and set next bill number
            setTimeout(async () => {
                clearForm();
                document.getElementById('billNumber').value = currentBillNum + 1;
            }, 1500);
        } else {
            showNotification('Error saving PDF: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('Error generating PDF:', error);
        showNotification('Error generating PDF: ' + error.message, 'error');
    }
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

function clearForm() {
    // Don't reset bill type - keep previous selection
    const currentBillType = document.getElementById('billType').value;

    document.getElementById('billingForm').reset();

    // Restore bill type
    document.getElementById('billType').value = currentBillType;

    // Reset items table
    const tbody = document.getElementById('itemsBody');
    tbody.innerHTML = `
        <tr class="item-row">
            <td class="item-number">1</td>
            <td><input type="text" class="item-particulars" placeholder="Item/Service description" required></td>
            <td><input type="number" class="item-qty" value="1" min="1" required></td>
            <td><input type="number" class="item-amount" placeholder="0.00" step="0.01" min="0" required></td>
            <td><button type="button" class="remove-btn" onclick="removeItem(this)">Remove</button></td>
        </tr>
    `;

    // Reset totals
    document.getElementById('grandTotal').value = '';
    document.getElementById('basicAmount').value = '';
    document.getElementById('sgst').value = '';
    document.getElementById('cgst').value = '';
    document.getElementById('amountInWords').value = '';

    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('billDate').value = today;
}

async function openBillsFolder() {
    const result = await ipcRenderer.invoke('open-bills-folder');
    if (!result.success) {
        showNotification('Error opening folder: ' + result.error, 'error');
    }
}

function showNotification(message, type = 'success') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.className = 'notification show' + (type === 'error' ? ' error' : '');

    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}
