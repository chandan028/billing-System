const { ipcRenderer } = require('electron');

// Initialize bill number on load
window.addEventListener('DOMContentLoaded', async () => {
    const billNumber = await ipcRenderer.invoke('get-next-bill-number');
    document.getElementById('billNumber').value = billNumber + 1;

    // Set today's date
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('billDate').value = today;

    // Add event listeners
    setupEventListeners();
});

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
    let basicAmount = 0;

    rows.forEach(row => {
        const qty = parseFloat(row.querySelector('.item-qty').value) || 0;
        const amount = parseFloat(row.querySelector('.item-amount').value) || 0;
        basicAmount += qty * amount;
    });

    const sgst = basicAmount * 0.09;
    const cgst = basicAmount * 0.09;
    const grandTotal = basicAmount + sgst + cgst;

    document.getElementById('basicAmount').value = basicAmount.toFixed(2);
    document.getElementById('sgst').value = sgst.toFixed(2);
    document.getElementById('cgst').value = cgst.toFixed(2);
    document.getElementById('grandTotal').value = grandTotal.toFixed(2);

    // Convert to words
    document.getElementById('amountInWords').value = numberToWords(grandTotal);
}

function numberToWords(num) {
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

    if (num === 0) return 'Zero Rupees Only';

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
    const paise = Math.round((num - Math.floor(num)) * 100);

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
}

async function generatePDF(e) {
    e.preventDefault();

    try {
        // Get form data
        const formData = {
            billNumber: document.getElementById('billNumber').value,
            billDate: document.getElementById('billDate').value,
            customerName: document.getElementById('customerName').value,
            customerPhone: document.getElementById('customerPhone').value,
            vehicleMake: document.getElementById('vehicleMake').value,
            vehicleNumber: document.getElementById('vehicleNumber').value,
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

        // Set green color for borders and text
        const green = [46, 204, 113];

        // Header - Company Info
        doc.setFillColor(...green);
        doc.rect(10, 10, 190, 50, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.text('GSTIN: 29CGBPM0738G1ZF', 15, 18);
        doc.text('CASH BILL', 95, 18);
        doc.text('Mob: 94488 07237', 160, 18);
        doc.text('77957 40356', 167, 23);

        doc.setFontSize(20);
        doc.setFont(undefined, 'bold');
        doc.text('FIX PLUS AUTO CARE CENTER', 105, 33, { align: 'center' });

        doc.setFontSize(11);
        doc.setFont(undefined, 'normal');
        doc.text('All New Generation Car Spare Parts Available', 105, 40, { align: 'center' });
        doc.text('C-8, SRI MAHADESHWARA COLLEGE ROAD,KOLLEGALA-571440', 105, 47, { align: 'center' });

        // Bill details
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(11);
        doc.text(`No. ${formData.billNumber}`, 15, 70);
        doc.text(`Date: ${formatDate(formData.billDate)}`, 150, 70);

        doc.text(`Customer Name: ${formData.customerName}`, 15, 80);
        doc.text(`Cell/Tele No: ${formData.customerPhone}`, 15, 87);

        doc.text(`Vehicle Make: ${formData.vehicleMake}`, 15, 97);
        doc.text(`Vehicle No: ${formData.vehicleNumber}`, 120, 97);

        // Items table
        const tableStartY = 107;

        // Table header
        doc.setFillColor(...green);
        doc.rect(10, tableStartY, 190, 10, 'FD');
        doc.setTextColor(255, 255, 255);
        doc.setFont(undefined, 'bold');
        doc.text('No.', 15, tableStartY + 7);
        doc.text('Particulars', 35, tableStartY + 7);
        doc.text('Qty', 145, tableStartY + 7);
        doc.text('Amount', 170, tableStartY + 7);

        // Table rows
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, 'normal');
        let currentY = tableStartY + 10;

        items.forEach((item, index) => {
            if (currentY > 250) {
                doc.addPage();
                currentY = 20;
            }

            doc.text(item.no.toString(), 15, currentY + 7);
            doc.text(item.particulars, 35, currentY + 7);
            doc.text(item.qty.toString(), 145, currentY + 7);
            doc.text(parseFloat(item.amount).toFixed(2), 170, currentY + 7);

            // Draw line
            doc.setDrawColor(...green);
            doc.line(10, currentY + 10, 200, currentY + 10);

            currentY += 10;
        });

        // Totals section
        const totalsY = currentY + 10;

        doc.setFont(undefined, 'bold');
        doc.text('Basic:', 130, totalsY);
        doc.text(formData.basicAmount, 170, totalsY);

        doc.text('SGST 9%:', 130, totalsY + 7);
        doc.text(formData.sgst, 170, totalsY + 7);

        doc.text('CGST 9%:', 130, totalsY + 14);
        doc.text(formData.cgst, 170, totalsY + 14);

        // Draw line before total
        doc.setDrawColor(...green);
        doc.setLineWidth(1);
        doc.line(125, totalsY + 18, 195, totalsY + 18);

        doc.setFontSize(13);
        doc.text('Total:', 130, totalsY + 25);
        doc.text(formData.grandTotal, 170, totalsY + 25);

        // Amount in words
        doc.setFontSize(11);
        doc.setFont(undefined, 'normal');
        doc.text(`Received Rupees: ${formData.amountInWords}`, 15, totalsY + 35);

        // Signature
        doc.text('Signature', 160, totalsY + 50);
        doc.line(155, totalsY + 52, 195, totalsY + 52);

        // Save PDF
        const pdfData = doc.output('datauristring');
        const fileName = `Bill_${formData.billNumber}_${formData.customerName.replace(/\s+/g, '_')}_${Date.now()}.pdf`;

        const result = await ipcRenderer.invoke('save-pdf', { pdfData, fileName });

        if (result.success) {
            showNotification(`PDF saved successfully: ${fileName}`);

            // Update bill number
            await ipcRenderer.invoke('save-bill-number', parseInt(formData.billNumber));

            // Clear form and increment bill number
            setTimeout(() => {
                clearForm();
                document.getElementById('billNumber').value = parseInt(formData.billNumber) + 1;
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
    document.getElementById('billingForm').reset();

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
    document.getElementById('basicAmount').value = '';
    document.getElementById('sgst').value = '';
    document.getElementById('cgst').value = '';
    document.getElementById('grandTotal').value = '';
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
