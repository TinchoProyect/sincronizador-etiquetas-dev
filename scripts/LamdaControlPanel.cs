using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace LamdaControlCenter
{
    public class ServiceEntry
    {
        public string Key;
        public string Title;
        public string Subtitle;
        public int Port;
        public string ScriptRelativePath;
        public Process RunningProcess;
        public bool IsListening;
        public Panel RowPanel;
        public Label DotLabel;
        public Label TitleLabel;
        public Label PortLabel;
        public Label StatusBadge;
    }

    public class MainForm : Form
    {
        private string rootDir;
        private string hostLabel = "Equipo Local";
        private string nodeExePath;
        private string gitExePath;
        private string browserExePath;
        private string browserProfileDir;
        private Process labBrowserProcess;
        private Process mobileBrowserProcess;
        private string mobileBrowserProfileDir;
        private List<ServiceEntry> services = new List<ServiceEntry>();
        private System.Windows.Forms.Timer uiTimer;
        private bool isStartingSequence = false;
        private bool isStoppingSequence = false;
        private bool isCheckingPorts = false;
        private int startWorkerRunning = 0;
        private bool pendingManualOpenBrowser = false;
        private bool browserOpenedForCurrentRun = false;
        private DateTime startSequenceTimestamp = DateTime.MinValue;

        // UI Controls
        private Panel overallCard;
        private Label overallTitleLabel;
        private Label overallSubLabel;
        private ProgressBar startupProgressBar;
        private Button btnStart;
        private Button btnRestart;
        private Button btnStop;
        private Button btnOpenBrowser;
        private CheckBox chkAutoOpenBrowser;
        private Button btnGitPull;
        private Button btnGitPush;
        private Label lblGitCommit;
        private ToolTip mainToolTip;
        private Button btnRestoreDb;
        private Button btnOpenMobile;
        private Button btnQrMobile;
        private RichTextBox logBox;

        public MainForm(string rootDirOverride = null)
        {
            ResolvePaths(rootDirOverride);
            InitializeServicesList();
            BuildUserInterface();

            uiTimer = new System.Windows.Forms.Timer();
            uiTimer.Interval = 1000;
            uiTimer.Tick += UiTimer_Tick;
            uiTimer.Start();

            this.Shown += MainForm_Shown;
            this.FormClosing += MainForm_FormClosing;
        }

        private void ResolvePaths(string rootDirOverride = null)
        {
            if (!string.IsNullOrWhiteSpace(rootDirOverride) && Directory.Exists(rootDirOverride))
            {
                rootDir = rootDirOverride.TrimEnd('\\', '/');
            }
            else
            {
                string exeDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
                if (exeDir.EndsWith("scripts", StringComparison.OrdinalIgnoreCase))
                {
                    rootDir = Directory.GetParent(exeDir).FullName;
                }
                else
                {
                    rootDir = exeDir;
                }
            }


            string machine = (Environment.MachineName ?? "").Trim();
            if (machine.Equals("SERVEDIORA", StringComparison.OrdinalIgnoreCase))
            {
                hostLabel = "Notebook";
            }
            else if (machine.IndexOf("ALMACEN", StringComparison.OrdinalIgnoreCase) >= 0 ||
                     Directory.Exists(@"C:\Users\Martin\Documents\sincronizador-etiquetas - copia"))
            {
                hostLabel = "PcAlmacen";
            }
            else if (!string.IsNullOrWhiteSpace(machine))
            {
                hostLabel = machine;
            }

            if (!File.Exists(Path.Combine(rootDir, "package.json")))
            {
                string fallbackLab = @"C:\Users\Martin\Documents\LAMDA-Laboratorio";
                string fallbackDev = @"C:\Users\Martin\Downloads\LAMDA-Desarrollo";
                if (Directory.Exists(fallbackLab)) rootDir = fallbackLab;
                else if (Directory.Exists(fallbackDev)) rootDir = fallbackDev;
            }

            nodeExePath = @"C:\Program Files\nodejs\node.exe";
            if (!File.Exists(nodeExePath)) nodeExePath = "node";

            gitExePath = @"C:\Program Files\Git\cmd\git.exe";
            if (!File.Exists(gitExePath)) gitExePath = "git";

            browserProfileDir = Path.Combine(Path.GetTempPath(), "LamdaLaboratorioBrowserProfile");
            mobileBrowserProfileDir = Path.Combine(Path.GetTempPath(), "LamdaLaboratorioMobileProfile");
            string[] candidates = new string[]
            {
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe"
            };
            browserExePath = null;
            foreach (string c in candidates)
            {
                if (File.Exists(c))
                {
                    browserExePath = c;
                    break;
                }
            }
        }

        private void InitializeServicesList()
        {
            services.Add(new ServiceEntry
            {
                Key = "ETIQUETAS",
                Title = "Gestiones LAMDA y Etiquetas",
                Subtitle = "Panel Principal y Administración",
                Port = 3000,
                ScriptRelativePath = @"src\app-etiquetas\server.js"
            });
            services.Add(new ServiceEntry
            {
                Key = "PRODUCCION",
                Title = "Producción, Carros y Recetas",
                Subtitle = "Gestión de Ingredientes, Mixes e Inventario",
                Port = 3002,
                ScriptRelativePath = @"src\produccion\app.js"
            });
            services.Add(new ServiceEntry
            {
                Key = "PRESUPUESTOS",
                Title = "Presupuestos y Ventas",
                Subtitle = "Motor de Presupuestos y Retiros",
                Port = 3003,
                ScriptRelativePath = @"src\presupuestos\app.js"
            });
            services.Add(new ServiceEntry
            {
                Key = "FACTURACION",
                Title = "Facturación y Cuentas Bancarias",
                Subtitle = "ARCA Homologación y WhatsApp Espejo",
                Port = 3004,
                ScriptRelativePath = @"src\facturacion\app.js"
            });
            services.Add(new ServiceEntry
            {
                Key = "LOGISTICA",
                Title = "Logística, Búnker y App Móvil",
                Subtitle = "Rutas, Cuentas Corrientes y /mobile",
                Port = 3005,
                ScriptRelativePath = @"src\logistica\app.js"
            });
        }

        private void BuildUserInterface()
        {
            this.Text = "LAMDA — Panel de Control (Modo Laboratorio)";
            this.Size = new Size(760, 760);
            this.MinimumSize = new Size(740, 710);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(15, 23, 42); // #0f172a
            this.ForeColor = Color.FromArgb(248, 250, 252);
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            mainToolTip = new ToolTip();
            mainToolTip.AutoPopDelay = 12000;
            mainToolTip.InitialDelay = 300;
            mainToolTip.ReshowDelay = 200;
            mainToolTip.ShowAlways = true;

            string icoFile = Path.Combine(rootDir, @"scripts\lamda-lab.ico");
            if (File.Exists(icoFile))
            {
                try { this.Icon = new Icon(icoFile); } catch { }
            }

            // 1. Top Lab Header Banner (Amber)
            Panel headerBanner = new Panel();
            headerBanner.Dock = DockStyle.Top;
            headerBanner.Height = 64;
            headerBanner.BackColor = Color.FromArgb(180, 83, 9); // #b45309
            headerBanner.Padding = new Padding(18, 10, 18, 10);

            Label headerTitle = new Label();
            headerTitle.Text = "🛠️  LAMDA — CENTRO DE CONTROL (MODO LABORATORIO)";
            headerTitle.Font = new Font("Segoe UI", 12.5f, FontStyle.Bold);
            headerTitle.ForeColor = Color.FromArgb(255, 251, 235);
            headerTitle.AutoSize = true;
            headerTitle.Location = new Point(16, 10);
            headerBanner.Controls.Add(headerTitle);

            Label headerSub = new Label();
            headerSub.Text = "Base Local: etiquetas_pruebas  |  🔒 Supabase B2B Desconectado  |  👤 Auto-Login: Martin Ignacio Serrano";
            headerSub.Font = new Font("Segoe UI", 8.75f, FontStyle.Bold);
            headerSub.ForeColor = Color.FromArgb(253, 230, 138);
            headerSub.AutoSize = true;
            headerSub.Location = new Point(18, 36);
            headerBanner.Controls.Add(headerSub);

            this.Controls.Add(headerBanner);

            // Main container
            Panel contentPanel = new Panel();
            contentPanel.Dock = DockStyle.Fill;
            contentPanel.Padding = new Padding(18);
            this.Controls.Add(contentPanel);
            contentPanel.BringToFront();

            int y = 12;

            // 2. Overall Status Card + Progress Bar
            overallCard = new Panel();
            overallCard.Location = new Point(18, y);
            overallCard.Size = new Size(706, 78);
            overallCard.BackColor = Color.FromArgb(30, 41, 59); // #1e293b
            overallCard.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            overallTitleLabel = new Label();
            overallTitleLabel.Text = "VERIFICANDO ESTADO DE LOS SERVICIOS...";
            overallTitleLabel.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
            overallTitleLabel.ForeColor = Color.FromArgb(248, 250, 252);
            overallTitleLabel.AutoSize = true;
            overallTitleLabel.Location = new Point(16, 11);
            overallCard.Controls.Add(overallTitleLabel);

            overallSubLabel = new Label();
            overallSubLabel.Text = "Comprobando puertos locales 3000 a 3005...";
            overallSubLabel.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            overallSubLabel.ForeColor = Color.FromArgb(148, 163, 184);
            overallSubLabel.AutoSize = true;
            overallSubLabel.Location = new Point(17, 35);
            overallCard.Controls.Add(overallSubLabel);

            startupProgressBar = new ProgressBar();
            startupProgressBar.Location = new Point(16, 56);
            startupProgressBar.Size = new Size(674, 12);
            startupProgressBar.Minimum = 0;
            startupProgressBar.Maximum = 5;
            startupProgressBar.Value = 0;
            startupProgressBar.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
            overallCard.Controls.Add(startupProgressBar);

            contentPanel.Controls.Add(overallCard);
            y += 88;

            // 3. Primary Control Buttons Row
            Panel buttonsRow = new Panel();
            buttonsRow.Location = new Point(18, y);
            buttonsRow.Size = new Size(706, 44);
            buttonsRow.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            btnStart = CreateStyledButton("▶  Encender Servicios", Color.FromArgb(5, 150, 105), Color.White, 168);
            btnStart.Location = new Point(0, 0);
            btnStart.Click += (s, e) => StartAllServices();
            buttonsRow.Controls.Add(btnStart);

            btnRestart = CreateStyledButton("🔄  Reiniciar", Color.FromArgb(217, 119, 6), Color.White, 130);
            btnRestart.Location = new Point(176, 0);
            btnRestart.Click += (s, e) => RestartAllServices();
            buttonsRow.Controls.Add(btnRestart);

            btnStop = CreateStyledButton("⏹  Apagar Todo", Color.FromArgb(185, 28, 28), Color.White, 148);
            btnStop.Location = new Point(314, 0);
            btnStop.Click += (s, e) => StopAllServices(false);
            buttonsRow.Controls.Add(btnStop);

            btnOpenBrowser = CreateStyledButton("🌐  Abrir Sistema (localhost:3000)", Color.FromArgb(79, 70, 229), Color.White, 236);
            btnOpenBrowser.Location = new Point(470, 0);
            btnOpenBrowser.Click += (s, e) => OpenMainBrowserTab();
            buttonsRow.Controls.Add(btnOpenBrowser);

            contentPanel.Controls.Add(buttonsRow);
            y += 48;

            // Auto-open checkbox
            chkAutoOpenBrowser = new CheckBox();
            chkAutoOpenBrowser.Text = "Abrir automáticamente el navegador en http://localhost:3000 (1 sola pestaña) cuando los servicios estén activos";
            chkAutoOpenBrowser.Checked = false;
            chkAutoOpenBrowser.Font = new Font("Segoe UI", 8.8f, FontStyle.Regular);
            chkAutoOpenBrowser.ForeColor = Color.FromArgb(203, 213, 225);
            chkAutoOpenBrowser.AutoSize = true;
            chkAutoOpenBrowser.Location = new Point(20, y);
            contentPanel.Controls.Add(chkAutoOpenBrowser);
            y += 28;

            // 4. Individual Service Rows (5 rows)
            foreach (var svc in services)
            {
                Panel row = new Panel();
                row.Location = new Point(18, y);
                row.Size = new Size(706, 46);
                row.BackColor = Color.FromArgb(30, 41, 59);
                row.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

                Label dot = new Label();
                dot.Text = "●";
                dot.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
                dot.ForeColor = Color.FromArgb(239, 68, 68);
                dot.Location = new Point(12, 8);
                dot.AutoSize = true;
                row.Controls.Add(dot);

                Label titleLbl = new Label();
                titleLbl.Text = svc.Title;
                titleLbl.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
                titleLbl.ForeColor = Color.FromArgb(248, 250, 252);
                titleLbl.Location = new Point(38, 6);
                titleLbl.AutoSize = true;
                row.Controls.Add(titleLbl);

                Label subLbl = new Label();
                subLbl.Text = svc.Subtitle;
                subLbl.Font = new Font("Segoe UI", 8.25f, FontStyle.Regular);
                subLbl.ForeColor = Color.FromArgb(148, 163, 184);
                subLbl.Location = new Point(39, 25);
                subLbl.AutoSize = true;
                row.Controls.Add(subLbl);

                Label portLbl = new Label();
                portLbl.Text = "Puerto " + svc.Port;
                portLbl.Font = new Font("Consolas", 9.5f, FontStyle.Bold);
                portLbl.ForeColor = Color.FromArgb(125, 211, 252);
                portLbl.Location = new Point(430, 14);
                portLbl.AutoSize = true;
                row.Controls.Add(portLbl);

                Label statusBadge = new Label();
                statusBadge.Text = "APAGADO";
                statusBadge.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
                statusBadge.TextAlign = ContentAlignment.MiddleCenter;
                statusBadge.Size = new Size(150, 28);
                statusBadge.Location = new Point(542, 9);
                statusBadge.BackColor = Color.FromArgb(127, 29, 29);
                statusBadge.ForeColor = Color.FromArgb(254, 202, 202);
                statusBadge.Anchor = AnchorStyles.Top | AnchorStyles.Right;
                row.Controls.Add(statusBadge);

                svc.RowPanel = row;
                svc.DotLabel = dot;
                svc.TitleLabel = titleLbl;
                svc.PortLabel = portLbl;
                svc.StatusBadge = statusBadge;

                contentPanel.Controls.Add(row);
                y += 52;
            }

            y += 4;

            // 5. Git Actions Row (Explicit & Separate: Pull vs Push)
            Panel gitRow = new Panel();
            gitRow.Location = new Point(18, y);
            gitRow.Size = new Size(706, 36);
            gitRow.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            Label gitLabel = new Label();
            gitLabel.Text = "GitHub (desarrollo):";
            gitLabel.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            gitLabel.ForeColor = Color.FromArgb(148, 163, 184);
            gitLabel.Location = new Point(0, 8);
            gitLabel.AutoSize = true;
            gitRow.Controls.Add(gitLabel);

            btnGitPull = CreateSmallToolButton("⬇️  Traer actualizaciones", 136, 2, 280);
            btnGitPull.BackColor = Color.FromArgb(3, 105, 161); // Sky Blue #0369a1
            btnGitPull.ForeColor = Color.White;
            btnGitPull.FlatAppearance.BorderColor = Color.FromArgb(56, 189, 248);
            btnGitPull.Click += (s, e) => RunGitPullToLocalAsync();
            mainToolTip.SetToolTip(btnGitPull, "Descarga los cambios nuevos subidos a 'origin/desarrollo' hacia este Laboratorio (" + hostLabel + ") y, si está presente la carpeta de Producción Local del Switch ('main'), la alinea también con 'origin/main'. (Nunca sube cambios).");
            gitRow.Controls.Add(btnGitPull);

            btnGitPush = CreateSmallToolButton("⬆️  Subir avances", 426, 2, 280);
            btnGitPush.BackColor = Color.FromArgb(49, 46, 129); // Indigo #312e81
            btnGitPush.ForeColor = Color.FromArgb(224, 231, 255);
            btnGitPush.FlatAppearance.BorderColor = Color.FromArgb(129, 140, 248);
            btnGitPush.Click += (s, e) => RunGitPushFromLocalAsync();
            mainToolTip.SetToolTip(btnGitPush, "Verifica si tenés commits o avances locales en " + hostLabel + " y te pide confirmación explícita antes de subirlos a 'origin/desarrollo'. (Nunca mezcla con descarga).");
            gitRow.Controls.Add(btnGitPush);

            contentPanel.Controls.Add(gitRow);
            y += 38;

            // 6. Commit Status + Local Lab Utilities Row (DB Restore, Mobile App)
            Panel toolsRow = new Panel();
            toolsRow.Location = new Point(18, y);
            toolsRow.Size = new Size(706, 36);
            toolsRow.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            lblGitCommit = new Label();
            lblGitCommit.Text = "📌 Commit local (" + hostLabel + "): verificando...";
            lblGitCommit.Font = new Font("Consolas", 8.5f, FontStyle.Bold);
            lblGitCommit.ForeColor = Color.FromArgb(125, 211, 252);
            lblGitCommit.Location = new Point(0, 9);
            lblGitCommit.Size = new Size(286, 20);
            lblGitCommit.AutoEllipsis = true;
            toolsRow.Controls.Add(lblGitCommit);

            btnRestoreDb = CreateSmallToolButton("🗄️ Restaurar Base Pruebas", 292, 2, 168);
            btnRestoreDb.Click += (s, e) => RunRestoreDatabaseAsync();
            mainToolTip.SetToolTip(btnRestoreDb, "Restaura la base PostgreSQL local 'etiquetas_pruebas' trayendo la última foto real de Producción.");
            toolsRow.Controls.Add(btnRestoreDb);

            btnOpenMobile = CreateSmallToolButton("📱 Abrir /mobile", 466, 2, 114);
            btnOpenMobile.Click += (s, e) => OpenMobileTab();
            mainToolTip.SetToolTip(btnOpenMobile, "Abre la App Móvil Operativa en http://localhost:3005/mobile/home.html");
            toolsRow.Controls.Add(btnOpenMobile);

            btnQrMobile = CreateSmallToolButton("📲 QR Wi-Fi", 586, 2, 120);
            btnQrMobile.BackColor = Color.FromArgb(88, 28, 135); // Purple #581c87
            btnQrMobile.ForeColor = Color.FromArgb(243, 232, 255);
            btnQrMobile.FlatAppearance.BorderColor = Color.FromArgb(168, 85, 247);
            btnQrMobile.Click += (s, e) => OpenMobileQrModal();
            mainToolTip.SetToolTip(btnQrMobile, "Muestra el código QR y la URL con IP local Wi-Fi para escanear desde tu celular y abrir /mobile en Modo Laboratorio.");
            toolsRow.Controls.Add(btnQrMobile);

            contentPanel.Controls.Add(toolsRow);
            y += 40;

            // 7. Live Log Viewer
            logBox = new RichTextBox();
            logBox.Location = new Point(18, y);
            logBox.Size = new Size(706, 124);
            logBox.BackColor = Color.FromArgb(9, 13, 24);
            logBox.ForeColor = Color.FromArgb(203, 213, 225);
            logBox.Font = new Font("Consolas", 8.75f, FontStyle.Regular);
            logBox.ReadOnly = true;
            logBox.BorderStyle = BorderStyle.None;
            logBox.Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right;
            contentPanel.Controls.Add(logBox);
        }

        private Button CreateStyledButton(string text, Color bg, Color fg, int width)
        {
            Button btn = new Button();
            btn.Text = text;
            btn.Size = new Size(width, 40);
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderSize = 0;
            btn.BackColor = bg;
            btn.ForeColor = fg;
            btn.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btn.Cursor = Cursors.Hand;
            return btn;
        }

        private Button CreateSmallToolButton(string text, int x, int y, int width)
        {
            Button btn = new Button();
            btn.Text = text;
            btn.Location = new Point(x, y);
            btn.Size = new Size(width, 32);
            btn.FlatStyle = FlatStyle.Flat;
            btn.FlatAppearance.BorderColor = Color.FromArgb(71, 85, 105);
            btn.FlatAppearance.BorderSize = 1;
            btn.BackColor = Color.FromArgb(30, 41, 59);
            btn.ForeColor = Color.FromArgb(226, 232, 240);
            btn.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            btn.Cursor = Cursors.Hand;
            return btn;
        }

        private void AppendLog(string message)
        {
            if (this.IsDisposed) return;
            if (this.InvokeRequired)
            {
                try { this.BeginInvoke(new Action<string>(AppendLog), message); } catch { }
                return;
            }
            string line = string.Format("[{0}] {1}\r\n", DateTime.Now.ToString("HH:mm:ss"), message);
            logBox.AppendText(line);
            if (logBox.TextLength > 25000)
            {
                logBox.Text = logBox.Text.Substring(logBox.TextLength - 15000);
            }
            logBox.SelectionStart = logBox.TextLength;
            logBox.ScrollToCaret();
        }

        private void MainForm_Shown(object sender, EventArgs e)
        {
            AppendLog("Panel de Control LAMDA (Modo Laboratorio) iniciado.");
            AppendLog("Carpeta de trabajo: " + rootDir);
            UpdateGitCommitBadgeAsync();

            // Verificar estado inicial y si están apagados, encender automáticamente al abrir el panel
            Task.Factory.StartNew(() =>
            {
                int activeNow = CountListeningPortsSync();
                this.BeginInvoke(new Action(() =>
                {
                    UpdateVisualState();
                    if (activeNow < services.Count)
                    {
                        AppendLog("Iniciando automáticamente los 5 servicios del Modo Laboratorio...");
                        StartAllServices();
                    }
                    else
                    {
                        if (chkAutoOpenBrowser.Checked && !browserOpenedForCurrentRun)
                        {
                            AppendLog("Los 5 servicios ya estaban activos. Abriendo http://localhost:3000 (1 sola pestaña)...");
                            browserOpenedForCurrentRun = true;
                            OpenMainBrowserTab();
                        }
                        else
                        {
                            AppendLog("Los 5 servicios ya se encuentran activos.");
                        }
                    }
                }));
            });
        }

        private void UiTimer_Tick(object sender, EventArgs e)
        {
            if (isCheckingPorts) return;
            isCheckingPorts = true;

            Task.Factory.StartNew(() =>
            {
                try
                {
                    foreach (var svc in services)
                    {
                        svc.IsListening = IsGenuineLabServiceListening(svc.Port, 220);
                    }
                    if (!this.IsDisposed)
                    {
                        this.BeginInvoke(new Action(UpdateVisualState));
                    }
                }
                catch { }
                finally
                {
                    isCheckingPorts = false;
                }
            });
        }

        private int CountListeningPortsSync()
        {
            int count = 0;
            foreach (var svc in services)
            {
                svc.IsListening = IsGenuineLabServiceListening(svc.Port, 260);
                if (svc.IsListening) count++;
            }
            return count;
        }

        private bool IsGenuineLabServiceListening(int port, int timeoutMs)
        {
            if (!CheckPortOpen("127.0.0.1", port, timeoutMs)) return false;
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/lamda-manifest.json");
                req.Method = "GET";
                req.Timeout = Math.Max(450, timeoutMs);
                req.ReadWriteTimeout = 600;
                req.Proxy = null;
                req.KeepAlive = false;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                {
                    if ((int)resp.StatusCode != 200) return false;
                    using (Stream s = resp.GetResponseStream())
                    {
                        if (s == null) return false;
                        using (StreamReader reader = new StreamReader(s, Encoding.UTF8))
                        {
                            string body = reader.ReadToEnd();
                            return !string.IsNullOrEmpty(body) &&
                                   body.IndexOf("/?app=lamda-lab", StringComparison.OrdinalIgnoreCase) >= 0;
                        }
                    }
                }
            }
            catch
            {
                return false;
            }
        }

        private void KillProcessesListeningOnPort(int targetPort)
        {
            try
            {
                HashSet<int> pidsToKill = new HashSet<int>();
                ProcessStartInfo psi = new ProcessStartInfo("netstat.exe", "-ano -p tcp");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;

                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(2000);

                    string[] lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (string line in lines)
                    {
                        if (!line.Contains("LISTENING")) continue;
                        string[] parts = Regex.Split(line.Trim(), @"\s+");
                        if (parts.Length >= 5)
                        {
                            string localAddr = parts[1];
                            int colonIdx = localAddr.LastIndexOf(':');
                            if (colonIdx > 0)
                            {
                                int port;
                                int pid;
                                if (int.TryParse(localAddr.Substring(colonIdx + 1), out port) &&
                                    port == targetPort &&
                                    int.TryParse(parts[parts.Length - 1], out pid) &&
                                    pid > 0 && pid != Process.GetCurrentProcess().Id)
                                {
                                    pidsToKill.Add(pid);
                                }
                            }
                        }
                    }
                }

                foreach (int pid in pidsToKill)
                {
                    try
                    {
                        Process proc = Process.GetProcessById(pid);
                        proc.Kill();
                        proc.WaitForExit(1500);
                    }
                    catch { }
                }

                for (int i = 0; i < 8; i++)
                {
                    if (!CheckPortOpen("127.0.0.1", targetPort, 120)) break;
                    Thread.Sleep(150);
                }
            }
            catch { }
        }

        private bool CheckPortOpen(string host, int port, int timeoutMs)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    IAsyncResult result = client.BeginConnect(host, port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(TimeSpan.FromMilliseconds(timeoutMs));
                    if (!success) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        private void UpdateVisualState()
        {
            int activeCount = 0;
            foreach (var svc in services)
            {
                if (svc.IsListening) activeCount++;
            }

            if (activeCount == services.Count)
            {
                if (isStartingSequence)
                {
                    isStartingSequence = false;
                    AppendLog("✅ ¡Los 5 servicios del Modo Laboratorio están ACTIVOS y listos!");
                }
                if (pendingManualOpenBrowser)
                {
                    pendingManualOpenBrowser = false;
                    browserOpenedForCurrentRun = true;
                    OpenMainBrowserTab();
                }
                else if (chkAutoOpenBrowser.Checked && !browserOpenedForCurrentRun)
                {
                    browserOpenedForCurrentRun = true;
                    OpenMainBrowserTab();
                }
            }

            if (isStartingSequence && (DateTime.Now - startSequenceTimestamp).TotalSeconds > 28)
            {
                isStartingSequence = false;
                if (pendingManualOpenBrowser && IsGenuineLabServiceListening(3000, 350))
                {
                    pendingManualOpenBrowser = false;
                    browserOpenedForCurrentRun = true;
                    OpenMainBrowserTab();
                }
            }

            startupProgressBar.Value = Math.Min(startupProgressBar.Maximum, activeCount);

            // Actualizar cada fila de servicio
            foreach (var svc in services)
            {
                if (svc.IsListening)
                {
                    svc.DotLabel.ForeColor = Color.FromArgb(16, 185, 129); // Verde
                    svc.StatusBadge.Text = "✔  ACTIVO";
                    svc.StatusBadge.BackColor = Color.FromArgb(6, 95, 70);
                    svc.StatusBadge.ForeColor = Color.FromArgb(167, 243, 208);
                }
                else if (isStartingSequence)
                {
                    svc.DotLabel.ForeColor = Color.FromArgb(245, 158, 11); // Ámbar
                    svc.StatusBadge.Text = "⏳  INICIANDO...";
                    svc.StatusBadge.BackColor = Color.FromArgb(146, 64, 14);
                    svc.StatusBadge.ForeColor = Color.FromArgb(254, 243, 199);
                }
                else
                {
                    svc.DotLabel.ForeColor = Color.FromArgb(239, 68, 68); // Rojo
                    svc.StatusBadge.Text = "●  APAGADO";
                    svc.StatusBadge.BackColor = Color.FromArgb(127, 29, 29);
                    svc.StatusBadge.ForeColor = Color.FromArgb(254, 202, 202);
                }
            }

            // Actualizar tarjeta general superior
            if (activeCount == services.Count)
            {
                overallCard.BackColor = Color.FromArgb(6, 78, 59); // Verde oscuro
                overallTitleLabel.Text = "🟢  SISTEMA ACTIVO — 5 de 5 Servicios en Línea";
                overallTitleLabel.ForeColor = Color.FromArgb(167, 243, 208);
                overallSubLabel.Text = "Modo Laboratorio listo para usar. Cerrar esta ventana apagará todos los servicios.";
                overallSubLabel.ForeColor = Color.FromArgb(209, 250, 229);
            }
            else if (isStartingSequence)
            {
                overallCard.BackColor = Color.FromArgb(120, 53, 15); // Ámbar oscuro
                overallTitleLabel.Text = string.Format("🟡  ARRANCANDO SERVICIOS... ({0} de {1} activos)", activeCount, services.Count);
                overallTitleLabel.ForeColor = Color.FromArgb(254, 243, 199);
                overallSubLabel.Text = "Levantando módulos de LAMDA en segundo plano, aguardá unos segundos...";
                overallSubLabel.ForeColor = Color.FromArgb(253, 230, 138);
            }
            else if (activeCount == 0)
            {
                overallCard.BackColor = Color.FromArgb(69, 10, 10); // Rojo oscuro
                overallTitleLabel.Text = "🔴  SISTEMA APAGADO — 0 de 5 Servicios Activos";
                overallTitleLabel.ForeColor = Color.FromArgb(254, 202, 202);
                overallSubLabel.Text = "No hay ningún proceso de LAMDA corriendo en segundo plano (" + hostLabel + " 100% libre).";
                overallSubLabel.ForeColor = Color.FromArgb(252, 165, 165);
            }
            else
            {
                overallCard.BackColor = Color.FromArgb(30, 41, 59);
                overallTitleLabel.Text = string.Format("🟠  PARCIALMENTE ACTIVO — {0} de {1} Servicios en Línea", activeCount, services.Count);
                overallTitleLabel.ForeColor = Color.FromArgb(253, 224, 71);
                overallSubLabel.Text = "Tocá 'Encender Servicios' o 'Reiniciar' para levantar todos los módulos.";
                overallSubLabel.ForeColor = Color.FromArgb(203, 213, 225);
            }
        }

        private void StartAllServices()
        {
            if (isStoppingSequence) return;
            if (Interlocked.CompareExchange(ref startWorkerRunning, 1, 0) != 0)
            {
                isStartingSequence = true;
                UpdateVisualState();
                return;
            }

            isStartingSequence = true;
            browserOpenedForCurrentRun = false;
            startSequenceTimestamp = DateTime.Now;
            UpdateVisualState();

            Task.Factory.StartNew(() =>
            {
                try
                {
                    foreach (var svc in services)
                    {
                        if (isStoppingSequence) break;

                        bool genuineUp = IsGenuineLabServiceListening(svc.Port, 350);
                        if (genuineUp)
                        {
                            svc.IsListening = true;
                            AppendLog(string.Format("[{0}] Puerto {1} (Laboratorio genuino) ya se encuentra activo.", svc.Key, svc.Port));
                            continue;
                        }

                        bool portOccupied = CheckPortOpen("127.0.0.1", svc.Port, 200);
                        if (portOccupied)
                        {
                            if (svc.RunningProcess != null && !svc.RunningProcess.HasExited)
                            {
                                Thread.Sleep(700);
                                if (IsGenuineLabServiceListening(svc.Port, 500))
                                {
                                    svc.IsListening = true;
                                    continue;
                                }
                            }

                            AppendLog(string.Format("[{0}] ⚠️ El puerto {1} estaba ocupado por un proceso externo ajeno a Laboratorio. Liberando puerto para montar {2}...", svc.Key, svc.Port, svc.Title));
                            KillProcessesListeningOnPort(svc.Port);
                        }

                        StartSingleService(svc);
                        Thread.Sleep(250);
                    }
                }
                finally
                {
                    Interlocked.Exchange(ref startWorkerRunning, 0);
                }
            });
        }

        private void StartSingleService(ServiceEntry svc)
        {
            try
            {
                string scriptFullPath = Path.Combine(rootDir, svc.ScriptRelativePath);
                if (!File.Exists(scriptFullPath))
                {
                    AppendLog("ERROR: No se encontró " + scriptFullPath);
                    return;
                }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodeExePath;
                psi.Arguments = "\"" + scriptFullPath + "\"";
                psi.WorkingDirectory = rootDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;
                psi.RedirectStandardError = true;
                psi.StandardOutputEncoding = Encoding.UTF8;
                psi.StandardErrorEncoding = Encoding.UTF8;
                psi.EnvironmentVariables["MODO_LABORATORIO"] = "true";
                psi.EnvironmentVariables["LAMDA_MODO_LABORATORIO"] = "true";
                psi.EnvironmentVariables["DB_NAME"] = "etiquetas_pruebas";
                psi.EnvironmentVariables["SAFE_REDIRECT_WHATSAPP_TO"] = "5492216615746";

                Process proc = new Process();
                proc.StartInfo = psi;
                proc.EnableRaisingEvents = true;

                string keyCopy = svc.Key;
                proc.OutputDataReceived += (s, e) =>
                {
                    if (!string.IsNullOrWhiteSpace(e.Data))
                    {
                        if (e.Data.Contains("corriendo") || e.Data.Contains("Iniciado") || e.Data.Contains("Escuchando") || e.Data.Contains("puerto") || e.Data.Contains("MODO LABORATORIO") || e.Data.Contains("B2B-LAB"))
                        {
                            AppendLog(string.Format("[{0}] {1}", keyCopy, e.Data.Trim()));
                        }
                    }
                };
                proc.ErrorDataReceived += (s, e) =>
                {
                    if (!string.IsNullOrWhiteSpace(e.Data) && !e.Data.Contains("ExperimentalWarning") && !e.Data.Contains("DeprecationWarning"))
                    {
                        AppendLog(string.Format("[{0}-WARN] {1}", keyCopy, e.Data.Trim()));
                    }
                };

                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                svc.RunningProcess = proc;
                AppendLog(string.Format("▶ Iniciando {0} (Puerto {1}, PID {2})...", svc.Title, svc.Port, proc.Id));
            }
            catch (Exception ex)
            {
                AppendLog(string.Format("ERROR al iniciar {0}: {1}", svc.Title, ex.Message));
            }
        }

        private void RestartAllServices()
        {
            AppendLog("🔄 Reiniciando todos los servicios del Modo Laboratorio...");
            Task.Factory.StartNew(() =>
            {
                StopAllServicesSync();
                Thread.Sleep(800);
                this.BeginInvoke(new Action(StartAllServices));
            });
        }

        private void StopAllServices(bool silent)
        {
            if (!silent) AppendLog("⏹ Deteniendo todos los servicios de LAMDA y cerrando ventana del navegador...");
            isStartingSequence = false;
            pendingManualOpenBrowser = false;
            isStoppingSequence = true;

            Task.Factory.StartNew(() =>
            {
                CloseLamdaBrowserWindows();
                StopAllServicesSync();
                isStoppingSequence = false;
                CountListeningPortsSync();
                if (!this.IsDisposed)
                {
                    this.BeginInvoke(new Action(() =>
                    {
                        UpdateVisualState();
                        if (!silent) AppendLog("✅ Todos los servicios y la ventana del navegador fueron cerrados. " + hostLabel + " 100% libre.");
                    }));
                }
            });
        }

        private void StopAllServicesSync()
        {
            // 1. Matar procesos hijos lanzados directamente por este panel
            foreach (var svc in services)
            {
                try
                {
                    if (svc.RunningProcess != null && !svc.RunningProcess.HasExited)
                    {
                        svc.RunningProcess.Kill();
                        svc.RunningProcess.WaitForExit(1500);
                    }
                }
                catch { }
                finally
                {
                    svc.RunningProcess = null;
                }
            }

            // 2. Barrido de seguridad por puertos 3000, 3002, 3003, 3004, 3005 mediante netstat -ano
            try
            {
                HashSet<int> targetPorts = new HashSet<int> { 3000, 3002, 3003, 3004, 3005, 3006, 5173 };
                HashSet<int> pidsToKill = new HashSet<int>();

                ProcessStartInfo psi = new ProcessStartInfo("netstat.exe", "-ano -p tcp");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.RedirectStandardOutput = true;

                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(2000);

                    string[] lines = output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                    foreach (string line in lines)
                    {
                        if (!line.Contains("LISTENING")) continue;
                        string[] parts = Regex.Split(line.Trim(), @"\s+");
                        if (parts.Length >= 5)
                        {
                            string localAddr = parts[1];
                            int colonIdx = localAddr.LastIndexOf(':');
                            if (colonIdx > 0)
                            {
                                int port;
                                int pid;
                                if (int.TryParse(localAddr.Substring(colonIdx + 1), out port) &&
                                    targetPorts.Contains(port) &&
                                    int.TryParse(parts[parts.Length - 1], out pid) &&
                                    pid > 0 && pid != Process.GetCurrentProcess().Id)
                                {
                                    pidsToKill.Add(pid);
                                }
                            }
                        }
                    }
                }

                foreach (int pid in pidsToKill)
                {
                    try
                    {
                        Process proc = Process.GetProcessById(pid);
                        proc.Kill();
                        proc.WaitForExit(1500);
                    }
                    catch { }
                }
            }
            catch { }

            foreach (var svc in services)
            {
                svc.IsListening = false;
            }
        }

        private IntPtr FindExistingLamdaBrowserWindow()
        {
            try
            {
                if (labBrowserProcess != null && !labBrowserProcess.HasExited)
                {
                    labBrowserProcess.Refresh();
                    if (labBrowserProcess.MainWindowHandle != IntPtr.Zero && IsWindowVisible(labBrowserProcess.MainWindowHandle))
                    {
                        return labBrowserProcess.MainWindowHandle;
                    }
                }
            }
            catch { }

            IntPtr found = IntPtr.Zero;
            IntPtr myHandle = IntPtr.Zero;
            try { if (this.IsHandleCreated) myHandle = this.Handle; } catch { }

            EnumWindows((hWnd, lParam) =>
            {
                if (hWnd == myHandle || !IsWindowVisible(hWnd)) return true;
                StringBuilder sb = new StringBuilder(512);
                GetWindowText(hWnd, sb, 512);
                string title = sb.ToString();
                if (string.IsNullOrWhiteSpace(title)) return true;
                if (title.Contains("Panel de Control (Modo Laboratorio)") || title.Contains("CENTRO DE CONTROL")) return true;

                if (title.Contains("[PRUEBAS]") ||
                    title.Contains("LAMDA Móvil Lab") ||
                    title.Contains("localhost:3000") ||
                    title.Contains("localhost:3005"))
                {
                    RECT r;
                    if (GetWindowRect(hWnd, out r) && (r.Right - r.Left) < 600) return true;
                    found = hWnd;
                    return false;
                }
                return true;
            }, IntPtr.Zero);

            return found;
        }

        private void LaunchInIsolatedBrowser(string url, bool newWindow)
        {
            if (!string.IsNullOrEmpty(browserExePath) && File.Exists(browserExePath))
            {
                try { Directory.CreateDirectory(browserProfileDir); } catch { }
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = browserExePath;
                string winFlag = newWindow ? "--new-window " : "";
                psi.Arguments = string.Format("--user-data-dir=\"{0}\" --no-first-run --no-default-browser-check --disable-session-crashed-bubble {1}\"{2}\"", browserProfileDir, winFlag, url);
                psi.UseShellExecute = false;
                labBrowserProcess = Process.Start(psi);
            }
            else
            {
                labBrowserProcess = Process.Start(url);
            }
        }

        private void LaunchMobileSimulatorWindow(string url)
        {
            if (!string.IsNullOrEmpty(browserExePath) && File.Exists(browserExePath))
            {
                try
                {
                    if (mobileBrowserProcess != null && !mobileBrowserProcess.HasExited)
                    {
                        try { mobileBrowserProcess.CloseMainWindow(); } catch { }
                        Thread.Sleep(150);
                        if (!mobileBrowserProcess.HasExited)
                        {
                            try { mobileBrowserProcess.Kill(); } catch { }
                        }
                    }
                }
                catch { }

                try
                {
                    Directory.CreateDirectory(mobileBrowserProfileDir);
                    string prefsFile = Path.Combine(mobileBrowserProfileDir, @"Default\Preferences");
                    if (File.Exists(prefsFile))
                    {
                        try { File.Delete(prefsFile); } catch { }
                    }
                }
                catch { }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = browserExePath;
                psi.Arguments = string.Format(
                    "--user-data-dir=\"{0}\" --app=\"{1}\" --window-size=412,915 --window-position=120,40 --no-first-run --no-default-browser-check --disable-session-crashed-bubble",
                    mobileBrowserProfileDir,
                    url
                );
                psi.UseShellExecute = false;
                mobileBrowserProcess = Process.Start(psi);

                Task.Factory.StartNew(() =>
                {
                    for (int i = 0; i < 15; i++)
                    {
                        Thread.Sleep(200);
                        try
                        {
                            IntPtr targetHwnd = IntPtr.Zero;
                            if (mobileBrowserProcess != null && !mobileBrowserProcess.HasExited)
                            {
                                mobileBrowserProcess.Refresh();
                                if (mobileBrowserProcess.MainWindowHandle != IntPtr.Zero)
                                {
                                    targetHwnd = mobileBrowserProcess.MainWindowHandle;
                                }
                            }
                            if (targetHwnd != IntPtr.Zero && IsWindowVisible(targetHwnd))
                            {
                                RECT r;
                                if (GetWindowRect(targetHwnd, out r) && (r.Right - r.Left) > 520)
                                {
                                    ShowWindow(targetHwnd, 9);
                                    MoveWindow(targetHwnd, 120, 40, 412, 915, true);
                                }
                                break;
                            }
                        }
                        catch { }
                    }
                });
            }
            else
            {
                mobileBrowserProcess = Process.Start(url);
            }
        }

        private void CloseLamdaBrowserWindows()
        {
            try
            {
                IntPtr myHandle = IntPtr.Zero;
                try { if (this.IsHandleCreated) myHandle = this.Handle; } catch { }

                EnumWindows((hWnd, lParam) =>
                {
                    if (hWnd == myHandle || !IsWindowVisible(hWnd)) return true;
                    StringBuilder sb = new StringBuilder(512);
                    GetWindowText(hWnd, sb, 512);
                    string title = sb.ToString();
                    if (string.IsNullOrWhiteSpace(title)) return true;
                    if (title.Contains("Panel de Control (Modo Laboratorio)") || title.Contains("CENTRO DE CONTROL")) return true;

                    if (title.Contains("[PRUEBAS]") ||
                        title.Contains("LAMDA Móvil Lab") ||
                        title.Contains("localhost:3000") ||
                        title.Contains("localhost:3005"))
                    {
                        PostMessage(hWnd, WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
                    }
                    return true;
                }, IntPtr.Zero);
            }
            catch { }

            try
            {
                if (labBrowserProcess != null && !labBrowserProcess.HasExited)
                {
                    try { labBrowserProcess.CloseMainWindow(); } catch { }
                    Thread.Sleep(200);
                    if (!labBrowserProcess.HasExited)
                    {
                        try { labBrowserProcess.Kill(); } catch { }
                    }
                }
            }
            catch { }
            finally
            {
                labBrowserProcess = null;
                try
                {
                    if (mobileBrowserProcess != null && !mobileBrowserProcess.HasExited)
                    {
                        try { mobileBrowserProcess.CloseMainWindow(); } catch { }
                        Thread.Sleep(150);
                        if (!mobileBrowserProcess.HasExited)
                        {
                            try { mobileBrowserProcess.Kill(); } catch { }
                        }
                    }
                }
                catch { }
                mobileBrowserProcess = null;
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -WindowStyle Hidden -Command \"Get-CimInstance Win32_Process -Filter \\\"Name = 'chrome.exe' OR Name = 'msedge.exe'\\\" | Where-Object { $_.CommandLine -like '*LamdaLaboratorioBrowserProfile*' -or $_.CommandLine -like '*LamdaLaboratorioMobileProfile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }\"");
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                using (Process p = Process.Start(psi))
                {
                    p.WaitForExit(2000);
                }
            }
            catch { }
        }

        private void OpenMainBrowserTab()
        {
            bool port3000LabUp = IsGenuineLabServiceListening(3000, 450);
            if (!port3000LabUp)
            {
                pendingManualOpenBrowser = true;
                AppendLog("⏳ Preparando servicios reales de LAMDA Laboratorio en :3000 (se abrirá automáticamente apenas estén montados)...");
                StartAllServices();
                return;
            }

            pendingManualOpenBrowser = false;

            IntPtr existingWindow = FindExistingLamdaBrowserWindow();
            if (existingWindow != IntPtr.Zero)
            {
                AppendLog("🌐 La ventana de LAMDA ya está abierta. Activándola al frente sin abrir duplicados...");
                try
                {
                    if (IsIconic(existingWindow)) ShowWindow(existingWindow, 9);
                    SetForegroundWindow(existingWindow);
                }
                catch { }
                return;
            }

            AppendLog("🌐 Abriendo ventana única del sistema en http://localhost:3000...");
            try
            {
                LaunchInIsolatedBrowser("http://localhost:3000", true);
            }
            catch (Exception ex)
            {
                AppendLog("Error al abrir navegador: " + ex.Message);
            }
        }

        private void OpenMobileTab()
        {
            bool port3005Up = IsGenuineLabServiceListening(3005, 350);
            if (!port3005Up)
            {
                MessageBox.Show("El servicio de Logística (Puerto 3005) está apagado. Tocá 'Encender Servicios' primero.", "Servicio Apagado", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            AppendLog("📱 Abriendo Simulador Móvil Vertical (412x915 Samsung) en http://localhost:3005/mobile/home.html...");
            try
            {
                LaunchMobileSimulatorWindow("http://localhost:3005/mobile/home.html");
            }
            catch (Exception ex)
            {
                AppendLog("Error al abrir /mobile: " + ex.Message);
            }
        }

        private class LanCandidate
        {
            public string InterfaceName;
            public string IpAddress;
            public int Score;
            public string DisplayText
            {
                get { return InterfaceName + " — http://" + IpAddress + ":3005/mobile/home.html"; }
            }
            public string Url
            {
                get { return "http://" + IpAddress + ":3005/mobile/home.html"; }
            }
            public override string ToString() { return DisplayText; }
        }

        private List<LanCandidate> GetLocalLanIpCandidates()
        {
            List<LanCandidate> list = new List<LanCandidate>();
            try
            {
                string[] virtualKeywords = new string[] {
                    "tailscale", "zerotier", "vethernet", "wsl", "hyper-v",
                    "virtualbox", "vmware", "docker", "vpn", "tap", "tun",
                    "bluetooth", "npcap", "loopback", "teredo", "isatap"
                };

                foreach (NetworkInterface ni in NetworkInterface.GetAllNetworkInterfaces())
                {
                    if (ni.OperationalStatus != OperationalStatus.Up) continue;
                    if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback ||
                        ni.NetworkInterfaceType == NetworkInterfaceType.Tunnel) continue;

                    string nameAndDesc = ((ni.Name ?? "") + " " + (ni.Description ?? "")).ToLowerInvariant();
                    bool isVirtual = false;
                    foreach (string kw in virtualKeywords)
                    {
                        if (nameAndDesc.Contains(kw)) { isVirtual = true; break; }
                    }
                    if (isVirtual) continue;

                    IPInterfaceProperties ipProps = ni.GetIPProperties();
                    if (ipProps == null) continue;

                    bool hasIpv4Gateway = false;
                    foreach (GatewayIPAddressInformation gw in ipProps.GatewayAddresses)
                    {
                        if (gw.Address != null &&
                            gw.Address.AddressFamily == AddressFamily.InterNetwork &&
                            !gw.Address.Equals(IPAddress.Any))
                        {
                            hasIpv4Gateway = true;
                            break;
                        }
                    }

                    foreach (UnicastIPAddressInformation uni in ipProps.UnicastAddresses)
                    {
                        if (uni.Address == null || uni.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                        string ip = uni.Address.ToString();
                        if (ip.StartsWith("127.") || ip.StartsWith("169.254.")) continue;

                        // Evitar rango CGNAT / Tailscale (100.64.0.0/10)
                        string[] octets = ip.Split('.');
                        if (octets.Length == 4)
                        {
                            int o0, o1;
                            if (int.TryParse(octets[0], out o0) && int.TryParse(octets[1], out o1))
                            {
                                if (o0 == 100 && o1 >= 64 && o1 <= 127) continue;
                            }
                        }

                        int score = 0;
                        if (hasIpv4Gateway) score += 100;
                        if (ni.NetworkInterfaceType == NetworkInterfaceType.Wireless80211) score += 50;
                        else if (ni.NetworkInterfaceType == NetworkInterfaceType.Ethernet) score += 40;
                        if (ip.StartsWith("192.168.") || ip.StartsWith("10.") || ip.StartsWith("172.")) score += 20;

                        list.Add(new LanCandidate
                        {
                            InterfaceName = ni.Name,
                            IpAddress = ip,
                            Score = score
                        });
                    }
                }
            }
            catch { }

            list.Sort((a, b) => b.Score.CompareTo(a.Score));
            return list;
        }

        private bool IsFirewallRulePresent()
        {
            try
            {
                int code;
                string outTxt = RunCliCommand("netsh.exe", "advfirewall firewall show rule name=\"LAMDA Laboratorio Movil LAN (TCP 3000-3005)\"", out code);
                return code == 0 && (outTxt.Contains("3005") || outTxt.Contains("LAMDA Laboratorio Movil LAN"));
            }
            catch
            {
                return false;
            }
        }

        private bool EnsureFirewallRuleForMobileLan()
        {
            if (IsFirewallRulePresent()) return true;
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(
                    "netsh.exe",
                    "advfirewall firewall add rule name=\"LAMDA Laboratorio Movil LAN (TCP 3000-3005)\" dir=in action=allow protocol=TCP localport=3000,3002,3003,3004,3005 profile=any"
                );
                psi.Verb = "runas";
                psi.UseShellExecute = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                using (Process p = Process.Start(psi))
                {
                    if (p != null) p.WaitForExit(10000);
                }
            }
            catch { }
            return IsFirewallRulePresent();
        }

        private Image GenerateQrBitmapForUrl(string url)
        {
            try
            {
                string tempPng = Path.Combine(Path.GetTempPath(), "lamda_lab_mobile_qr.png");
                if (File.Exists(tempPng))
                {
                    try { File.Delete(tempPng); } catch { }
                }

                string escapedPng = tempPng.Replace("\\", "/");
                string escapedUrl = url.Replace("'", "\\'");
                string nodeScript =
                    "let q; try { q = require('./src/facturacion/node_modules/qrcode'); } catch(e) { q = require('qrcode'); } " +
                    "q.toFile('" + escapedPng + "', '" + escapedUrl + "', { width: 260, margin: 2 }, (err) => { if (err) process.exit(1); });";

                int code;
                RunCliCommand(nodeExePath, "-e \"" + nodeScript.Replace("\"", "\\\"") + "\"", out code);

                if (File.Exists(tempPng))
                {
                    byte[] bytes = File.ReadAllBytes(tempPng);
                    using (MemoryStream ms = new MemoryStream(bytes))
                    {
                        return new Bitmap(Image.FromStream(ms));
                    }
                }
            }
            catch (Exception ex)
            {
                AppendLog("Error generando código QR: " + ex.Message);
            }
            return null;
        }

        private void OpenMobileQrModal()
        {
            bool port3005Up = IsGenuineLabServiceListening(3005, 350);
            if (!port3005Up)
            {
                DialogResult dr = MessageBox.Show(
                    "El servicio de Logística / Móvil (Puerto 3005) está apagado.\n\n¿Querés encender los 5 servicios ahora mismo y mostrar el código QR?",
                    "Servicio Móvil (3005) Apagado",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );
                if (dr == DialogResult.Yes)
                {
                    StartAllServices();
                }
            }

            List<LanCandidate> candidates = GetLocalLanIpCandidates();
            if (candidates.Count == 0)
            {
                candidates.Add(new LanCandidate { InterfaceName = "Localhost", IpAddress = "127.0.0.1", Score = 0 });
            }

            bool fwOk = IsFirewallRulePresent();
            if (!fwOk)
            {
                fwOk = EnsureFirewallRuleForMobileLan();
            }

            Form modal = new Form();
            modal.Text = "📲 QR Celular (Wi-Fi) — LAMDA Móvil Lab (etiquetas_pruebas)";
            modal.Size = new Size(480, 560);
            modal.FormBorderStyle = FormBorderStyle.FixedDialog;
            modal.MaximizeBox = false;
            modal.MinimizeBox = false;
            modal.StartPosition = FormStartPosition.CenterParent;
            modal.BackColor = Color.FromArgb(15, 23, 42); // #0f172a
            modal.ForeColor = Color.FromArgb(248, 250, 252);
            if (this.Icon != null) modal.Icon = this.Icon;

            Label titleLbl = new Label();
            titleLbl.Text = "📲 Probar LAMDA Móvil en tu Celular (Wi-Fi)";
            titleLbl.Font = new Font("Segoe UI", 12f, FontStyle.Bold);
            titleLbl.ForeColor = Color.FromArgb(248, 250, 252);
            titleLbl.Location = new Point(20, 16);
            titleLbl.AutoSize = true;
            modal.Controls.Add(titleLbl);

            Label subLbl = new Label();
            subLbl.Text = "Conectá tu teléfono al mismo Wi-Fi, escaneá el QR con la cámara\r\ny abrirá directamente LAMDA Móvil Lab conectado a 'etiquetas_pruebas'.";
            subLbl.Font = new Font("Segoe UI", 8.8f, FontStyle.Regular);
            subLbl.ForeColor = Color.FromArgb(148, 163, 184);
            subLbl.Location = new Point(21, 42);
            subLbl.Size = new Size(430, 36);
            modal.Controls.Add(subLbl);

            Label netLbl = new Label();
            netLbl.Text = "Placa Wi-Fi / Red Local detectada:";
            netLbl.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            netLbl.ForeColor = Color.FromArgb(196, 181, 253);
            netLbl.Location = new Point(21, 84);
            netLbl.AutoSize = true;
            modal.Controls.Add(netLbl);

            ComboBox cmbInterfaces = new ComboBox();
            cmbInterfaces.DropDownStyle = ComboBoxStyle.DropDownList;
            cmbInterfaces.Font = new Font("Consolas", 9f, FontStyle.Bold);
            cmbInterfaces.BackColor = Color.FromArgb(30, 41, 59);
            cmbInterfaces.ForeColor = Color.FromArgb(248, 250, 252);
            cmbInterfaces.Location = new Point(21, 104);
            cmbInterfaces.Size = new Size(422, 26);
            foreach (LanCandidate c in candidates) cmbInterfaces.Items.Add(c);
            cmbInterfaces.SelectedIndex = 0;
            modal.Controls.Add(cmbInterfaces);

            Panel qrCard = new Panel();
            qrCard.Size = new Size(276, 276);
            qrCard.Location = new Point(94, 140);
            qrCard.BackColor = Color.White;
            modal.Controls.Add(qrCard);

            PictureBox picQr = new PictureBox();
            picQr.Size = new Size(260, 260);
            picQr.Location = new Point(8, 8);
            picQr.SizeMode = PictureBoxSizeMode.StretchImage;
            qrCard.Controls.Add(picQr);

            TextBox txtUrl = new TextBox();
            txtUrl.ReadOnly = true;
            txtUrl.Font = new Font("Consolas", 9.5f, FontStyle.Bold);
            txtUrl.BackColor = Color.FromArgb(30, 41, 59);
            txtUrl.ForeColor = Color.FromArgb(56, 189, 248);
            txtUrl.BorderStyle = BorderStyle.FixedSingle;
            txtUrl.Location = new Point(21, 428);
            txtUrl.Size = new Size(318, 26);
            modal.Controls.Add(txtUrl);

            Button btnCopy = CreateSmallToolButton("📋 Copiar URL", 345, 425, 98);
            btnCopy.BackColor = Color.FromArgb(3, 105, 161);
            btnCopy.ForeColor = Color.White;
            btnCopy.Click += (s, e) =>
            {
                try
                {
                    Clipboard.SetText(txtUrl.Text);
                    btnCopy.Text = "✅ Copiada";
                }
                catch { }
            };
            modal.Controls.Add(btnCopy);

            Label fwStatusLbl = new Label();
            fwStatusLbl.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            fwStatusLbl.Location = new Point(21, 464);
            fwStatusLbl.Size = new Size(422, 20);
            fwStatusLbl.Text = fwOk
                ? "🟢 Firewall Windows: Puerto 3005 habilitado para conexiones Wi-Fi / LAN"
                : "⚠️ Firewall Windows: Si el celular no conecta, tocá 'Habilitar Firewall'";
            fwStatusLbl.ForeColor = fwOk ? Color.FromArgb(52, 211, 153) : Color.FromArgb(251, 191, 36);
            modal.Controls.Add(fwStatusLbl);

            if (!fwOk)
            {
                Button btnEnableFw = CreateSmallToolButton("🛡️ Habilitar Firewall Windows (Puerto 3005)", 21, 486, 280);
                btnEnableFw.BackColor = Color.FromArgb(180, 83, 9);
                btnEnableFw.ForeColor = Color.White;
                btnEnableFw.Click += (s, e) =>
                {
                    if (EnsureFirewallRuleForMobileLan())
                    {
                        fwStatusLbl.Text = "🟢 Firewall Windows: Puerto 3005 habilitado para conexiones Wi-Fi / LAN";
                        fwStatusLbl.ForeColor = Color.FromArgb(52, 211, 153);
                        btnEnableFw.Visible = false;
                    }
                };
                modal.Controls.Add(btnEnableFw);
            }

            Button btnClose = CreateSmallToolButton("Cerrar", 345, 486, 98);
            btnClose.Click += (s, e) => modal.Close();
            modal.Controls.Add(btnClose);

            Action updateSelectedCandidate = () =>
            {
                LanCandidate sel = cmbInterfaces.SelectedItem as LanCandidate;
                if (sel == null) return;
                txtUrl.Text = sel.Url;
                btnCopy.Text = "📋 Copiar URL";
                Image img = GenerateQrBitmapForUrl(sel.Url);
                if (picQr.Image != null)
                {
                    try { picQr.Image.Dispose(); } catch { }
                }
                picQr.Image = img;
                AppendLog("📲 QR Móvil Wi-Fi generado para: " + sel.Url);
            };

            cmbInterfaces.SelectedIndexChanged += (s, e) => updateSelectedCandidate();
            updateSelectedCandidate();

            modal.ShowDialog(this);
        }

        private void SetGitButtonsEnabled(bool enabled)
        {
            if (this.IsDisposed) return;
            if (this.InvokeRequired)
            {
                try { this.BeginInvoke(new Action<bool>(SetGitButtonsEnabled), enabled); } catch { }
                return;
            }
            btnGitPull.Enabled = enabled;
            btnGitPush.Enabled = enabled;
        }

        private void CleanRuntimeNoiseFiles()
        {
            try
            {
                int code;
                RunCliCommand(gitExePath, "checkout -- data/ia_credito_ledger.json", out code);
                RunCliCommand(gitExePath, "checkout -- pagina-publica-web/dist", out code);
                RunCliCommand(gitExePath, "checkout -- src/app-etiquetas/documentos", out code);
            }
            catch { }
        }

        private void UpdateGitCommitBadgeAsync()
        {
            Task.Factory.StartNew(() =>
            {
                try
                {
                    int code;
                    RunCliCommand(gitExePath, "config core.hooksPath .githooks", out code);
                    string shortInfo = RunCliCommand(gitExePath, "log -1 --format=\"%h — %s\"", out code).Trim();
                    string fullInfo = RunCliCommand(gitExePath, "log -1 --format=\"Commit %h (%ci): %s\"", out code).Trim();
                    if (string.IsNullOrWhiteSpace(shortInfo)) shortInfo = "desconocido";
                    if (!this.IsDisposed)
                    {
                        this.BeginInvoke(new Action(() =>
                        {
                            lblGitCommit.Text = "📌 Commit local (" + hostLabel + "): " + shortInfo;
                            mainToolTip.SetToolTip(lblGitCommit, fullInfo);
                        }));
                    }
                }
                catch { }
            });
        }

        private class ProdStandbySyncResult
        {
            public bool Exists;
            public bool Updated;
            public string IncomingCommits;
            public string CurrentCommit;
            public string ErrorMessage;
        }

        private ProdStandbySyncResult SyncLocalProductionStandbyRepo()
        {
            ProdStandbySyncResult res = new ProdStandbySyncResult();
            string prodDir = @"C:\Users\Martin\Documents\sincronizador-etiquetas - copia";
            if (!Directory.Exists(prodDir) || !Directory.Exists(Path.Combine(prodDir, ".git")))
            {
                res.Exists = false;
                return res;
            }

            res.Exists = true;
            try
            {
                int code;
                RunCliCommandInDir(prodDir, gitExePath, "checkout -- data/ia_credito_ledger.json", out code);
                RunCliCommandInDir(prodDir, gitExePath, "checkout -- pagina-publica-web/dist", out code);
                RunCliCommandInDir(prodDir, gitExePath, "checkout -- src/app-etiquetas/documentos", out code);

                int fetchCode;
                string fetchOut = RunCliCommandInDir(prodDir, gitExePath, "fetch origin main", out fetchCode);
                if (fetchCode != 0)
                {
                    res.ErrorMessage = fetchOut.Trim();
                    return res;
                }

                string incomingMain = RunCliCommandInDir(prodDir, gitExePath, "log HEAD..origin/main --oneline", out code).Trim();
                if (!string.IsNullOrWhiteSpace(incomingMain))
                {
                    AppendLog("📥 [SWITCH LOCAL] Alineando carpeta de Producción Local ('sincronizador-etiquetas - copia') con 'origin/main'...");
                    RunCliCommandInDir(prodDir, gitExePath, "checkout -f main", out code);
                    RunCliCommandInDir(prodDir, gitExePath, "reset --hard origin/main", out code);
                    RunCliCommandInDir(prodDir, gitExePath, "config core.hooksPath .githooks", out code);
                    res.Updated = true;
                    res.IncomingCommits = incomingMain;
                }

                try
                {
                    string auditScript = Path.Combine(rootDir, @"scripts\auditarDiferenciasEsquemaDb.js");
                    if (File.Exists(auditScript))
                    {
                        int applyProdCode;
                        RunCliCommand(nodeExePath, "\"" + auditScript + "\" --apply-local-etiquetas", out applyProdCode);
                    }
                }
                catch { }

                res.CurrentCommit = RunCliCommandInDir(prodDir, gitExePath, "log -1 --format=\"%h — %s (%cr)\"", out code).Trim();
            }
            catch (Exception ex)
            {
                res.ErrorMessage = ex.Message;
            }
            return res;
        }

        private void RunGitPullToLocalAsync()
        {
            SetGitButtonsEnabled(false);
            AppendLog("⬇️ [TRAER ACTUALIZACIONES] Consultando ramas en GitHub ('origin/desarrollo' y 'origin/main')...");
            Task.Factory.StartNew(() =>
            {
                try
                {
                    CleanRuntimeNoiseFiles();

                    int fetchCode;
                    string fetchOut = RunCliCommand(gitExePath, "fetch origin desarrollo", out fetchCode);
                    if (fetchCode != 0)
                    {
                        AppendLog("[ERROR GIT FETCH] " + fetchOut.Trim());
                        this.BeginInvoke(new Action(() =>
                        {
                            SetGitButtonsEnabled(true);
                            MessageBox.Show(
                                "No se pudo consultar GitHub ('origin/desarrollo'). Revisá tu conexión a Internet.\n\nDetalle:\n" + fetchOut.Trim(),
                                "Error al Consultar GitHub",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Error
                            );
                        }));
                        return;
                    }

                    int logCode;
                    string incomingCommits = RunCliCommand(gitExePath, "log HEAD..origin/desarrollo --oneline", out logCode).Trim();
                    bool labUpdated = false;
                    string incomingStat = "";

                    if (!string.IsNullOrWhiteSpace(incomingCommits))
                    {
                        int statCode;
                        incomingStat = RunCliCommand(gitExePath, "diff --stat HEAD..origin/desarrollo", out statCode).Trim();

                        // Si hubiera algún archivo rastreado modificado localmente, guardarlo en stash preventivo antes de bajar
                        int statusCode;
                        string dirtyTracked = RunCliCommand(gitExePath, "status --porcelain --untracked-files=no", out statusCode).Trim();
                        bool stashedLocal = false;
                        if (!string.IsNullOrWhiteSpace(dirtyTracked))
                        {
                            AppendLog("ℹ️ Resguardando modificaciones locales temporalmente (git stash) antes de actualizar...");
                            int stashCode;
                            RunCliCommand(gitExePath, "stash push -m \"auto-stash-panel-laboratorio\"", out stashCode);
                            stashedLocal = (stashCode == 0);
                        }

                        AppendLog("📥 Descargando commits nuevos de 'origin/desarrollo' hacia " + hostLabel + ":\r\n" + incomingCommits);
                        int pullCode;
                        string pullOut = RunCliCommand(gitExePath, "pull --rebase origin desarrollo", out pullCode);
                        AppendLog("[GIT PULL] " + pullOut.Trim());

                        if (stashedLocal)
                        {
                            int popCode;
                            RunCliCommand(gitExePath, "stash pop", out popCode);
                        }

                        if (pullCode != 0)
                        {
                            this.BeginInvoke(new Action(() =>
                            {
                                SetGitButtonsEnabled(true);
                                MessageBox.Show(
                                    "Ocurrió un conflicto o error al intentar aplicar los cambios en " + hostLabel + ":\n\n" + pullOut.Trim(),
                                    "Error al Traer Actualizaciones",
                                    MessageBoxButtons.OK,
                                    MessageBoxIcon.Error
                                );
                            }));
                            return;
                        }
                        labUpdated = true;
                    }

                    // Aplicar automáticamente tablas o columnas nuevas sobre etiquetas_pruebas desde migrations/schema_laboratorio_snapshot.json
                    try
                    {
                        string auditScript = Path.Combine(rootDir, @"scripts\auditarDiferenciasEsquemaDb.js");
                        if (File.Exists(auditScript))
                        {
                            int applyCode;
                            string applyOut = RunCliCommand(nodeExePath, "\"" + auditScript + "\" --apply-lab", out applyCode);
                            if (!string.IsNullOrWhiteSpace(applyOut)) AppendLog(applyOut.Trim());
                        }
                    }
                    catch { }

                    // Si en este equipo existe la carpeta de Producción Local del Switch ('sincronizador-etiquetas - copia'), alinearla también con origin/main
                    ProdStandbySyncResult prodSync = SyncLocalProductionStandbyRepo();
                    if (prodSync.Exists)
                    {
                        if (!string.IsNullOrWhiteSpace(prodSync.ErrorMessage))
                        {
                            AppendLog("⚠️ [SWITCH LOCAL] Aviso sincronizando Producción Local: " + prodSync.ErrorMessage);
                        }
                        else if (prodSync.Updated)
                        {
                            AppendLog("✅ [SWITCH LOCAL] Carpeta de Producción Local ('main') actualizada a: " + prodSync.CurrentCommit);
                        }
                        else
                        {
                            AppendLog("✅ [SWITCH LOCAL] Carpeta de Producción Local ('main') ya está al día: " + prodSync.CurrentCommit);
                        }
                    }

                    CleanRuntimeNoiseFiles();
                    UpdateGitCommitBadgeAsync();

                    int curCode;
                    string currentCommit = RunCliCommand(gitExePath, "log -1 --format=\"%h — %s (%cr)\"", out curCode).Trim();

                    if (!labUpdated && (!prodSync.Exists || !prodSync.Updated))
                    {
                        AppendLog("✅ " + hostLabel + " ya está al día con 'origin/desarrollo'. Último commit: " + currentCommit);
                        string prodStatusLine = prodSync.Exists
                            ? ("\n📌 Producción Local / Switch ('main'):\n" + prodSync.CurrentCommit)
                            : "";
                        this.BeginInvoke(new Action(() =>
                        {
                            SetGitButtonsEnabled(true);
                            MessageBox.Show(
                                "✅ Este equipo (" + hostLabel + ") ya está 100% al día con GitHub.\n\n" +
                                "No había cambios nuevos para descargar (esquema de base de datos verificado).\n\n" +
                                "📌 Laboratorio ('desarrollo'):\n" + currentCommit + prodStatusLine,
                                hostLabel + " al Día (Sin Cambios Nuevos)",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Information
                            );
                        }));
                        return;
                    }

                    AppendLog("✅ Actualizaciones aplicadas en " + hostLabel + ". Reiniciando los 5 servicios automáticamente...");

                    string prodSummaryBlock = "";
                    if (prodSync.Exists)
                    {
                        prodSummaryBlock = prodSync.Updated
                            ? ("\n\n🛡️ Producción Local / Switch ('main') actualizada:\n" + prodSync.IncomingCommits)
                            : ("\n\n🛡️ Producción Local / Switch ('main') al día:\n" + prodSync.CurrentCommit);
                    }

                    this.BeginInvoke(new Action(() =>
                    {
                        SetGitButtonsEnabled(true);
                        if (labUpdated)
                        {
                            RestartAllServices();
                        }
                        MessageBox.Show(
                            "✅ Se descargaron y aplicaron las actualizaciones en " + hostLabel + ".\n\n" +
                            (labUpdated
                                ? ("📥 Commits traídos en Laboratorio ('desarrollo'):\n" + incomingCommits + "\n\n📂 Resumen de archivos:\n" + incomingStat)
                                : ("📌 Laboratorio ('desarrollo') ya estaba al día:\n" + currentCommit)) +
                            prodSummaryBlock +
                            (labUpdated ? "\n\n🔄 Los 5 servicios del Modo Laboratorio se están reiniciando automáticamente con el código nuevo." : ""),
                            "Actualizaciones Traídas (" + hostLabel + ")",
                            MessageBoxButtons.OK,
                            MessageBoxIcon.Information
                        );
                    }));
                }
                catch (Exception ex)
                {
                    this.BeginInvoke(new Action(() =>
                    {
                        SetGitButtonsEnabled(true);
                        AppendLog("ERROR al traer actualizaciones: " + ex.Message);
                    }));
                }
            });
        }

        private void RunGitPushFromLocalAsync()
        {
            SetGitButtonsEnabled(false);
            AppendLog("⬆️ [SUBIR AVANCES] Verificando si hay commits o cambios locales en " + hostLabel + " para subir...");
            Task.Factory.StartNew(() =>
            {
                try
                {
                    CleanRuntimeNoiseFiles();

                    // Exportar snapshot automático de esquema de etiquetas_pruebas antes de subir avances
                    try
                    {
                        string auditScript = Path.Combine(rootDir, @"scripts\auditarDiferenciasEsquemaDb.js");
                        if (File.Exists(auditScript))
                        {
                            int audCode;
                            RunCliCommand(nodeExePath, "\"" + auditScript + "\" --export-lab", out audCode);
                        }
                    }
                    catch { }

                    int fetchCode;
                    RunCliCommand(gitExePath, "fetch origin desarrollo", out fetchCode);

                    int statusCode;
                    string dirtyTracked = RunCliCommand(gitExePath, "status --porcelain --untracked-files=no", out statusCode).Trim();

                    if (!string.IsNullOrWhiteSpace(dirtyTracked))
                    {
                        AppendLog("📦 Confirmando automáticamente archivos modificados en Laboratorio antes de subir...");
                        int addCode, commitCode;
                        RunCliCommand(gitExePath, "add -u", out addCode);
                        RunCliCommand(gitExePath, "commit -m \"chore(desarrollo): sincronizar avances y esquema de Laboratorio\"", out commitCode);
                    }

                    int aheadCode;
                    string unpushedCommits = RunCliCommand(gitExePath, "log origin/desarrollo..HEAD --oneline", out aheadCode).Trim();

                    if (string.IsNullOrWhiteSpace(unpushedCommits))
                    {
                        int curCode;
                        string currentCommit = RunCliCommand(gitExePath, "log -1 --format=\"%h — %s\"", out curCode).Trim();
                        AppendLog("ℹ️ No hay avances nuevos para subir (el equipo ya está sincronizado con GitHub).");
                        this.BeginInvoke(new Action(() =>
                        {
                            SetGitButtonsEnabled(true);
                            MessageBox.Show(
                                "No hay avances nuevos para subir (el equipo ya está sincronizado con GitHub).\n\n" +
                                "📌 Commit local actual (" + hostLabel + "): " + currentCommit,
                                "Sin Avances Nuevos para Subir",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Information
                            );
                        }));
                        return;
                    }

                    int statCode;
                    string pushStat = RunCliCommand(gitExePath, "diff --stat origin/desarrollo..HEAD", out statCode).Trim();

                    this.BeginInvoke(new Action(() =>
                    {
                        DialogResult confirm = MessageBox.Show(
                            "¿Confirmás subir los siguientes avances desde " + hostLabel + " hacia la rama 'desarrollo' en GitHub?\n\n" +
                            "📤 Commits listos para subir:\n" + unpushedCommits + "\n\n" +
                            "📂 Archivos incluidos:\n" + pushStat,
                            "Confirmar Subida de Avances (" + hostLabel + ")",
                            MessageBoxButtons.YesNo,
                            MessageBoxIcon.Question
                        );

                        if (confirm != DialogResult.Yes)
                        {
                            AppendLog("⏹ Subida a GitHub cancelada por el operador.");
                            SetGitButtonsEnabled(true);
                            return;
                        }

                        AppendLog("⬆️ Subiendo commits locales hacia 'origin/desarrollo'...");
                        Task.Factory.StartNew(() =>
                        {
                            int pushCode;
                            string pushOut = RunCliCommand(gitExePath, "push origin desarrollo", out pushCode);
                            AppendLog("[GIT PUSH] " + pushOut.Trim());
                            UpdateGitCommitBadgeAsync();

                            this.BeginInvoke(new Action(() =>
                            {
                                SetGitButtonsEnabled(true);
                                if (pushCode == 0)
                                {
                                    MessageBox.Show(
                                        "✅ Los avances de " + hostLabel + " se subieron exitosamente a la rama 'desarrollo' en GitHub.\n\n" +
                                        "📤 Commits publicados:\n" + unpushedCommits,
                                        "Avances Subidos a GitHub",
                                        MessageBoxButtons.OK,
                                        MessageBoxIcon.Information
                                    );
                                }
                                else
                                {
                                    MessageBox.Show(
                                        "No se pudo completar el push hacia 'origin/desarrollo'.\n\n" +
                                        "Si hay cambios nuevos en GitHub, tocá primero '⬇️ Traer actualizaciones'.\n\nDetalle:\n" + pushOut.Trim(),
                                        "Error al Subir Avances",
                                        MessageBoxButtons.OK,
                                        MessageBoxIcon.Error
                                    );
                                }
                            }));
                        });
                    }));
                }
                catch (Exception ex)
                {
                    this.BeginInvoke(new Action(() =>
                    {
                        SetGitButtonsEnabled(true);
                        AppendLog("ERROR al subir avances: " + ex.Message);
                    }));
                }
            });
        }

        private void RunRestoreDatabaseAsync()
        {
            DialogResult dr = MessageBox.Show(
                "¿Querés refrescar la base de prueba 'etiquetas_pruebas' trayendo la última foto real de Producción (logistica.lamdaser.com)?\n\nEsto limpiará tus pruebas anteriores y cargará los últimos datos reales (con ARCA y WhatsApp protegidos en modo prueba).",
                "Restaurar Base de Pruebas",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Question
            );
            if (dr != DialogResult.Yes) return;

            btnRestoreDb.Enabled = false;
            AppendLog("🗄️ Iniciando restauración de 'etiquetas_pruebas'...");
            Task.Factory.StartNew(() =>
            {
                try
                {
                    StopAllServicesSync();
                    string scriptPath = Path.Combine(rootDir, @"scripts\dbRestaurarPruebas.js");
                    string outText = RunCliCommand(nodeExePath, "\"" + scriptPath + "\"");
                    AppendLog(outText.Trim());
                    this.BeginInvoke(new Action(() =>
                    {
                        btnRestoreDb.Enabled = true;
                        StartAllServices();
                        MessageBox.Show("Base de datos 'etiquetas_pruebas' restaurada exitosamente.", "Restauración Completada", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }));
                }
                catch (Exception ex)
                {
                    this.BeginInvoke(new Action(() =>
                    {
                        btnRestoreDb.Enabled = true;
                        AppendLog("ERROR Restauración: " + ex.Message);
                    }));
                }
            });
        }

        private string RunCliCommand(string exe, string args)
        {
            int code;
            return RunCliCommand(exe, args, out code);
        }

        private string RunCliCommand(string exe, string args, out int exitCode)
        {
            return RunCliCommandInDir(rootDir, exe, args, out exitCode);
        }

        private string RunCliCommandInDir(string workDir, string exe, string args, out int exitCode)
        {
            ProcessStartInfo psi = new ProcessStartInfo(exe, args);
            psi.WorkingDirectory = workDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;

            using (Process p = Process.Start(psi))
            {
                string stdout = p.StandardOutput.ReadToEnd();
                string stderr = p.StandardError.ReadToEnd();
                p.WaitForExit();
                exitCode = p.ExitCode;
                return stdout + (string.IsNullOrWhiteSpace(stderr) ? "" : ("\r\n" + stderr));
            }
        }

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        private const uint WM_CLOSE = 0x0010;

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc enumProc, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool IsIconic(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [DllImport("user32.dll")]
        private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [DllImport("user32.dll")]
        private static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

        [DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            try { uiTimer.Stop(); } catch { }
            try { CloseLamdaBrowserWindows(); } catch { }
            try { StopAllServicesSync(); } catch { }
            Environment.Exit(0);
        }

        [STAThread]
        public static void Main(string[] args)
        {
            string explicitRoot = (args != null && args.Length > 0) ? args[0] : null;
            try
            {
                string currentExe = Application.ExecutablePath;
                string tempDir = Path.GetTempPath().TrimEnd('\\', '/');
                if (!currentExe.StartsWith(tempDir, StringComparison.OrdinalIgnoreCase))
                {
                    string exeDir = Path.GetDirectoryName(currentExe).TrimEnd('\\', '/');
                    string resolvedRoot = exeDir.EndsWith("scripts", StringComparison.OrdinalIgnoreCase)
                        ? Directory.GetParent(exeDir).FullName
                        : exeDir;
                    string runtimeExe = Path.Combine(tempDir, "LamdaControlPanel_Runtime.exe");
                    try { File.Copy(currentExe, runtimeExe, true); } catch { }
                    if (File.Exists(runtimeExe))
                    {
                        ProcessStartInfo psi = new ProcessStartInfo(runtimeExe, "\"" + resolvedRoot + "\"");
                        psi.WorkingDirectory = resolvedRoot;
                        psi.UseShellExecute = false;
                        Process.Start(psi);
                        return;
                    }
                }
            }
            catch { }

            try
            {
                int currentId = Process.GetCurrentProcess().Id;
                List<Process> allExisting = new List<Process>();
                allExisting.AddRange(Process.GetProcessesByName("LamdaControlPanel"));
                allExisting.AddRange(Process.GetProcessesByName("LamdaControlPanel_Runtime"));
                foreach (Process p in allExisting)
                {
                    if (p.Id == currentId) continue;
                    if (p.MainWindowHandle != IntPtr.Zero)
                    {
                        ShowWindow(p.MainWindowHandle, 9);
                        SetForegroundWindow(p.MainWindowHandle);
                        return;
                    }
                    else
                    {
                        try { p.Kill(); } catch { }
                    }
                }
            }
            catch { }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new MainForm(explicitRoot));
        }
    }
}
