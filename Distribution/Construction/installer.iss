#ifndef AppVersion
  #define AppVersion "0.2.0"
#endif
#ifndef ProjectRoot
  #define ProjectRoot "..\.."
#endif
#ifndef BundleRoot
  #define BundleRoot ProjectRoot + "\.build-distribution\dist"
#endif
[Setup]
AppId={{AE81839C-F34C-4DBA-9D9B-C0B46D24B9C1}
AppName=Mon Cabinet d'Ostéo
AppVersion={#AppVersion}-essai
AppVerName=Mon Cabinet d'Ostéo {#AppVersion} — version d'essai
AppPublisher=Kiiwom
DefaultDirName={localappdata}\Programs\MonCabinetOsteo
DefaultGroupName=Mon Cabinet d'Ostéo
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#ProjectRoot}\Distribution\Installateur
OutputBaseFilename=MonCabinetOsteo-{#AppVersion}-essai-Setup-x64
SetupIconFile={#ProjectRoot}\app\cabinet.ico
UninstallDisplayIcon={app}\MonCabinetOsteo.exe
LicenseFile={#ProjectRoot}\LICENSE
InfoBeforeFile={#ProjectRoot}\Distribution\Installateur\AVANT-INSTALLATION.txt
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le bureau"; Flags: unchecked

[Files]
Source: "{#BundleRoot}\MonCabinetOsteo\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#BundleRoot}\RestaurerCabinet\*"; DestDir: "{app}\Restauration"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ProjectRoot}\LICENSE"; DestDir: "{app}"
Source: "{#ProjectRoot}\Distribution\Licences\*"; DestDir: "{app}\Licences"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ProjectRoot}\Distribution\Installateur\GUIDE-INSTALLATION.md"; DestDir: "{app}"

[Icons]
Name: "{group}\Mon Cabinet d'Ostéo"; Filename: "{app}\MonCabinetOsteo.exe"
Name: "{group}\Démonstration — dossiers fictifs"; Filename: "{app}\MonCabinetOsteo.exe"; Parameters: "--demo"
Name: "{group}\Désinstaller Mon Cabinet d'Ostéo"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Mon Cabinet d'Ostéo"; Filename: "{app}\MonCabinetOsteo.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\MonCabinetOsteo.exe"; Parameters: "--demo"; Description: "Ouvrir la démonstration"; Flags: nowait postinstall skipifsilent unchecked
