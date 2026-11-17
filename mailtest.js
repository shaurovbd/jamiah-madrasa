'use strict';
/* Sends one test notification to the admission mailbox, so you can confirm
   mail delivery works. cPanel > Node.js > Run JS script > mailtest. */
require('dotenv').config();
const mailer = require('./lib/mailer');

(async function () {
  const ok = await mailer.notifyNewApplication({
    applicationNo: 'TEST-0001',
    name: 'Test applicant (delivery check)',
    phone: '01700-000000',
    targetClass: 'Test',
    campus: 'Test'
  });
  console.log(ok ? 'MAILTEST: accepted by the mail server, addressed to ' + mailer.NOTIFY_TO
                 : 'MAILTEST: FAILED - see the error line above');
  setTimeout(function () { process.exit(ok ? 0 : 1); }, 500);
})();
