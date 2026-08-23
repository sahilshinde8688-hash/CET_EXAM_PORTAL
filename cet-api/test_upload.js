const fs = require('fs');
const path = require('path');
const filePath = path.resolve('..', 'MHT_CET_Sample_Question_Bank_No_Time_Language.xlsx');
const url = 'http://localhost:5000/api/questions/upload';

(async () => {
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    const res = await fetch(url, { method: 'POST', body: form });
    const text = await res.text();
    console.log('status', res.status);
    console.log('body', text);
  } catch (err) {
    console.error('ERROR', err);
  }
})();
