const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const config = require('./config');

class TaskSchedulerManager {
  constructor() {
    this.taskName = 'XboxGridSync-UpdateShield';
    this.tempXmlPath = path.join(os.tmpdir(), 'XboxGridSyncTask.xml');
  }

  isRegistered() {
    try {
      const out = execSync(`schtasks /Query /TN "${this.taskName}"`, {
        stdio: ['pipe', 'pipe', 'ignore'],
        encoding: 'utf8'
      });
      return out.includes(this.taskName);
    } catch (e) {
      return false;
    }
  }

  generateTaskXml(exePath) {
    // Escape XML characters in path
    const safeExe = exePath.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
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
      <Arguments>--restore-silent</Arguments>
    </Exec>
  </Actions>
</Task>`;
    return xml;
  }

  register(exePath = process.execPath) {
    try {
      const xml = this.generateTaskXml(exePath);
      // Write XML file using UTF-16LE with BOM as required by Windows Task Scheduler
      const bom = Buffer.from([0xFF, 0xFE]);
      const xmlBuf = Buffer.from(xml, 'utf16le');
      fs.writeFileSync(this.tempXmlPath, Buffer.concat([bom, xmlBuf]));

      const cmd = `schtasks /Create /TN "${this.taskName}" /XML "${this.tempXmlPath}" /F`;
      execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'] });

      try {
        fs.unlinkSync(this.tempXmlPath);
      } catch (e) {}

      console.log(`[Scheduler] Successfully registered Windows Task: ${this.taskName}`);
      config.set('taskSchedulerEnabled', true);
      return { success: true, message: 'Windows Task registered successfully.' };
    } catch (err) {
      console.warn(`[Scheduler] Could not register scheduled task:`, err.message);
      return { success: false, error: err.message };
    }
  }

  unregister() {
    try {
      const cmd = `schtasks /Delete /TN "${this.taskName}" /F`;
      execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'] });
      console.log(`[Scheduler] Successfully deleted Windows Task: ${this.taskName}`);
      config.set('taskSchedulerEnabled', false);
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  testTrigger() {
    try {
      if (this.isRegistered()) {
        execSync(`schtasks /Run /TN "${this.taskName}"`, { stdio: ['pipe', 'pipe', 'ignore'] });
        return { success: true, message: 'Windows Task successfully triggered via schtasks /Run.' };
      } else {
        const regRes = this.register();
        if (regRes.success) {
          execSync(`schtasks /Run /TN "${this.taskName}"`, { stdio: ['pipe', 'pipe', 'ignore'] });
          return { success: true, message: 'Task registered and executed successfully.' };
        }
        return regRes;
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
