# SAP-EWM-Fiori-Extension

Overview
In the Wave Simulation page, the Release All button is not blocked even when a wave is still in Red status.
To reduce mistakes, this Edge extension captures all Yellow and Red statuses and shows a clearer, more obvious alert for workers.

Why This Extension Exists
Prevent accidental release actions when risky wave statuses are present
Improve visibility of warning states (Yellow/Red)
Help workers react faster and avoid operational errors
What It Does
Scans the page for wave statuses
Detects Yellow and Red status values
Triggers a strong visual alert when these statuses are found
How to Use the Extension
Open Microsoft Edge.
Go to the Extensions page.
Enable Developer mode.
Click Load unpacked.
Select the extension folder.
Open the Wave Simulation page in your EWM system.
Let the extension scan the page automatically.
If Yellow or Red statuses are found, review the alert before clicking Release All.
Target Users
Warehouse and operations workers who use Wave Simulation and need clearer warning signals before releasing waves.

Notes
This extension is intended as an additional safety layer to improve awareness.
It does not replace system-side validations or business rules.

If you want, I can also tailor the How to Use section to match your exact internal URL/workflow (for example, the exact menu path your workers follow).
