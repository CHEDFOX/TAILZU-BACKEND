# The front door's read of a message in a project's chat (2026-11-01)

**46 of 46** read right, with the real small model; ₹0.39 in all.

| Right is | What it was read as |
|---|---|
| loop | loop 27, change 1 |
| change | change 7 |
| ask | ask 3 |
| handoff | handoff 3 |
| design | design 2 |
| research | research 2, loop 1 |

## Every case

| | Message | Right | Read as | The model's read |
|---|---|---|---|---|
| ✅ | thanks! | loop | loop | code_question 0.99 model |
| ✅ | good morning | loop | loop | code_question 1 model |
| ✅ | you're great, this helped a lot _(after a turn)_ | loop | loop | code_question 0.99 model |
| ✅ | hmm ok _(after a turn)_ | loop | loop | code_question 0.3 model |
| ✅ | shukriya bhai | loop | loop | code_question 0.99 model |
| ✅ | kya haal hai | loop | loop | code_question 1 model |
| ✅ | what is this project for? | loop | loop | code_question 0.98 model |
| ✅ | where is the login handled? | loop | loop | code_question 0.97 model |
| ✅ | how does the checkout talk to stripe? | loop | loop | code_question 0.92 model |
| ✅ | why is the cart page slow? | loop | loop | code_question 0.92 model |
| ✅ | what would break if I rename startSession? | loop | loop | code_question 0.98 model |
| ✅ | login kaha handle hota hai? | loop | loop | code_question 0.98 model |
| ✅ | यह प्रोजेक्ट किस लिए है? | loop | loop | code_question 0.99 model |
| ✅ | what changed lately? | loop | loop | code_question 0.96 model |
| ✅ | What should we do | loop | loop | code_question 0.72 model |
| ✅ | plan the next two weeks of work | loop | loop | code_question 0.94 model |
| ✅ | how should we structure the payments module? | loop | loop | code_question 0.88 model |
| ✅ | is this code good enough to launch? | loop | loop | code_question 0.99 model |
| ✅ | how do I run this locally? | loop | loop | code_question 0.97 model |
| ✅ | give me the vps setup commands | loop | loop | code_question 0.78 model |
| ✅ | what env settings does the server need? | loop | loop | code_question 0.91 model |
| ✅ | give me the database migration code to copy paste | loop / change | change | code_question 0.98 model |
| ✅ | show me the deploy script | loop | loop | code_question 0.93 model |
| ✅ | server pe deploy kaise karu? | loop | loop | code_question 0.94 model |
| ✅ | ?? _(after a turn)_ | loop | loop | code_question 0.9 rules |
| ✅ | why? _(after a turn)_ | loop | loop | code_question 0.9 rules |
| ✅ | explain simpler _(after a turn)_ | loop | loop | code_question 0.9 rules |
| ✅ | matlab? _(after a turn)_ | loop | loop | code_question 0.9 rules |
| ✅ | add a dark mode toggle to the settings page | change | change | code_question 0.97 model |
| ✅ | fix the bug where the cart total rounds wrong | change | change | code_question 0.98 model |
| ✅ | write tests for src/auth/session.ts | change | change | code_question 0.98 model |
| ✅ | rename startSession to beginSession everywhere | change | change | code_question 0.99 model |
| ✅ | make the pill show how long it has been recording | change | change | code_question 0.91 model |
| ✅ | cart me coupon field add karo | change | change | code_question 0.99 model |
| ✅ | upgrade react to the latest version | change | change | code_question 0.98 model |
| ✅ | fix it | ask | ask | code_task 0.28 model |
| ✅ | make it work | ask | ask | code_task 0.91 model |
| ✅ | theek karo | ask | ask | code_task 0.38 model |
| ✅ | make that change _(after a turn)_ | handoff | handoff | code_task 0.91 rules |
| ✅ | ok do it _(after a turn)_ | handoff | handoff | code_task 0.9 rules |
| ✅ | haan isko badal do _(after a turn)_ | handoff | handoff | code_task 0.95 rules |
| ✅ | show me how a pricing page would look | design | design | design 0.94 model |
| ✅ | design a settings screen for the app | design | design | design 0.94 model |
| ✅ | what's the latest version of next.js? | research / loop | research | code_question 0.98 model |
| ✅ | which email provider is cheapest for 10k mails a month? | research | research | code_question 0.96 model |
| ✅ | compare supabase and firebase for this project | research / loop | loop | code_question 0.98 model |
