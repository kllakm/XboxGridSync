const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const config = require('./config');

class TaskSchedulerManager {
  constructor() {
    this.taskName = 'Xbox Grid Sync - Automated Artwork Update Shield';
    this.legacyTaskName = 'XboxGridSync-UpdateShield';
    this.tempXmlPath = path.join(os.tmpdir(), 'XboxGridSyncTask.xml');
  }

  isRegistered() {
    return this.getRegisteredTaskName() !== null;
  }

  getRegisteredTaskName() {
    const { spawnSync } = require('child_process');
    try {
      const res = spawnSync('schtasks.exe', ['/Query', '/TN', this.taskName], { encoding: 'utf8' });
      if (res.status === 0 && (res.stdout.includes(this.taskName) || res.stdout.includes('Xbox Grid Sync'))) {
        return this.taskName;
      }
    } catch (e) {}

    try {
      const resLegacy = spawnSync('schtasks.exe', ['/Query', '/TN', this.legacyTaskName], { encoding: 'utf8' });
      if (resLegacy.status === 0 && resLegacy.stdout.includes(this.legacyTaskName)) {
        return this.legacyTaskName;
      }
    } catch (e2) {}

    return null;
  }

  getExecutionCommand(exePath = process.execPath) {
    const base = path.basename(exePath).toLowerCase();
    const isDev = base.includes('electron') || base.includes('node');
    if (isDev) {
      const mainScript = path.join(__dirname, 'index.js');
      return {
        exe: exePath,
        args: `"${mainScript}" --restore-silent`
      };
    }
    return {
      exe: exePath,
      args: '--restore-silent'
    };
  }

  generateTaskXml(exePath, args = '--restore-silent') {
    // Escape XML characters in path and arguments
    const safeExe = exePath.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const safeArgs = args.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

    const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Xbox Grid Sync automated artwork protection shield against Xbox PC App updates.</Description>
    <URI>\\${this.taskName}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <Delay>PT5S</Delay>
    </LogonTrigger>
    <EventTrigger>
      <Enabled>true</Enabled>
      <Subscription>&lt;QueryList&gt;&lt;Query Id="0" Path="Microsoft-Windows-AppXDeployment-Server/Operational"&gt;&lt;Select Path="Microsoft-Windows-AppXDeployment-Server/Operational"&gt;*[System[(EventID=854)]]&lt;/Select&gt;&lt;/Query&gt;&lt;/QueryList&gt;</Subscription>
    </EventTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${safeExe}</Command>
      <Arguments>${safeArgs}</Arguments>
    </Exec>
  </Actions>
</Task>`;
    return xml;
  }

  register(exePath = process.execPath, options = {}) {
    const { allowElevation = false } = (typeof options === 'object' && options !== null) ? options : { allowElevation: !!options };
    const { spawnSync } = require('child_process');
    try {
      const { exe, args } = this.getExecutionCommand(exePath);
      const xml = this.generateTaskXml(exe, args);

      // Clean up legacy task if it existed
      try {
        spawnSync('schtasks.exe', ['/Delete', '/TN', this.legacyTaskName, '/F'], { stdio: 'ignore' });
      } catch (e) {}

      // Write XML file using UTF-16LE with BOM
      const bom = Buffer.from([0xFF, 0xFE]);
      const xmlBuf = Buffer.from(xml, 'utf16le');
      fs.writeFileSync(this.tempXmlPath, Buffer.concat([bom, xmlBuf]));

      let registered = false;

      // Tier 1: Try direct creation with XML (Event 854 + Logon triggers)
      try {
        const res = spawnSync('schtasks.exe', ['/Create', '/TN', this.taskName, '/XML', this.tempXmlPath, '/F'], { encoding: 'utf8' });
        if (res.status === 0) {
          registered = this.isRegistered();
        }
      } catch (directErr) {
        // Direct creation without elevation throws Access is denied on Windows 10/11 for EventTriggers
      }

      // Tier 2: Try creating via elevated PowerShell ONLY if explicitly permitted by user interaction
      if (!registered && allowElevation) {
        try {
          const psScript = `Start-Process schtasks.exe -ArgumentList '/Create /TN \"${this.taskName}\" /XML \"${this.tempXmlPath}\" /F' -Verb RunAs -Wait -WindowStyle Hidden`;
          spawnSync('powershell.exe', ['-NoProfile', '-Command', psScript], { stdio: 'ignore', timeout: 15000 });
          registered = this.isRegistered();
        } catch (elevErr) {
          // UAC declined or unavailable
        }
      }

      // Tier 3: Standard User Fallback (Hourly Task - 100% works without administrator rights or UAC prompts)
      if (!registered) {
        try {
          const trCommand = `"${exe}" ${args}`.trim();
          const hourlyRes = spawnSync('schtasks.exe', [
            '/Create',
            '/SC', 'HOURLY',
            '/TN', this.taskName,
            '/TR', trCommand,
            '/F'
          ], { encoding: 'utf8' });
          if (hourlyRes.status === 0) {
            registered = this.isRegistered();
          }
        } catch (hourlyErr) {
          console.warn('[Scheduler] User-level task registration error:', hourlyErr.message);
        }
      }

      try {
        if (fs.existsSync(this.tempXmlPath)) fs.unlinkSync(this.tempXmlPath);
      } catch (e) {}

      if (registered) {
        console.log(`[Scheduler] Successfully registered Windows Task: "${this.taskName}"`);
        config.set('taskSchedulerEnabled', true);
        return {
          success: true,
          message: `Task "${this.taskName}" registered successfully in Windows Task Scheduler.`
        };
      } else {
        throw new Error(`Could not register task "${this.taskName}" in Windows Task Scheduler.`);
      }
    } catch (err) {
      console.warn(`[Scheduler] Could not register scheduled task:`, err.message);
      return { success: false, error: err.message };
    }
  }

  unregister() {
    const { spawnSync } = require('child_process');
    try {
      try {
        spawnSync('schtasks.exe', ['/Delete', '/TN', this.taskName, '/F'], { stdio: 'ignore' });
      } catch (e) {}
      try {
        spawnSync('schtasks.exe', ['/Delete', '/TN', this.legacyTaskName, '/F'], { stdio: 'ignore' });
      } catch (e) {}

      console.log(`[Scheduler] Successfully deleted Windows Task: "${this.taskName}"`);
      config.set('taskSchedulerEnabled', false);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  testTrigger() {
    const { spawnSync } = require('child_process');
    try {
      let taskToRun = this.getRegisteredTaskName();
      if (!taskToRun) {
        // When testing trigger explicitly, allow elevation if needed to establish the task
        const regRes = this.register(process.execPath, { allowElevation: true });
        if (!regRes.success) {
          return regRes;
        }
        taskToRun = this.getRegisteredTaskName() || this.taskName;
      }

      const runRes = spawnSync('schtasks.exe', ['/Run', '/TN', taskToRun], { encoding: 'utf8' });
      if (runRes.status === 0) {
        return {
          success: true,
          message: `Successfully executed "${taskToRun}". Headless background restoration executed.`
        };
      } else {
        return {
          success: false,
          error: runRes.stderr || runRes.stdout || `Exit code ${runRes.status}`
        };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  openTaskSchedulerGui() {
    try {
      const { spawn } = require('child_process');
      spawn('cmd.exe', ['/c', 'start', 'taskschd.msc'], { detached: true, stdio: 'ignore' }).unref();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = new TaskSchedulerManager();
