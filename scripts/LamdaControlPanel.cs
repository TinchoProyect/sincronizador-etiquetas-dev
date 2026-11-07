using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
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
        private string nodeExePath;
        private string gitExePath;
        private string browserExePath;
        private string browserProfileDir;
        private Process labBrowserProcess;
        private List<ServiceEntry> services = new List<ServiceEntry>();
        private System.Windows.Forms.Timer uiTimer;
        private bool isStartingSequence = false;
        private bool isStoppingSequence = false;
        private bool isCheckingPorts = false;
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


            if (!File.Exists(Path.Combine(rootDir, "package.json")))
            {
                string fallback = @"C:\Users\Martin\Downloads\LAMDA-Desarrollo";
                if (Directory.Exists(fallback)) rootDir = fallback;
            }

            nodeExePath = @"C:\Program Files\nodejs\node.exe";
            if (!File.Exists(nodeExePath)) nodeExePath = "node";

            gitExePath = @"C:\Program Files\Git\cmd\git.exe";
            if (!File.Exists(gitExePath)) gitExePath = "git";

            browserProfileDir = Path.Combine(Path.GetTempPath(), "LamdaLaboratorioBrowserProfile");
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
            chkAutoOpenBrowser.Checked = true;
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

            // 5. Git Actions Row (Explicit & Separate: Pull to Notebook vs Push from Notebook)
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

            btnGitPull = CreateSmallToolButton("⬇️  Traer actualizaciones a la Notebook", 136, 2, 280);
            btnGitPull.BackColor = Color.FromArgb(3, 105, 161); // Sky Blue #0369a1
            btnGitPull.ForeColor = Color.White;
            btnGitPull.FlatAppearance.BorderColor = Color.FromArgb(56, 189, 248);
            btnGitPull.Click += (s, e) => RunGitPullToNotebookAsync();
            mainToolTip.SetToolTip(btnGitPull, "Descarga únicamente los cambios nuevos subidos a la rama 'desarrollo' en GitHub hacia esta Notebook, informa qué trajo y reinicia los 5 servicios. (Nunca sube cambios).");
            gitRow.Controls.Add(btnGitPull);

            btnGitPush = CreateSmallToolButton("⬆️  Subir avances desde la Notebook", 426, 2, 280);
            btnGitPush.BackColor = Color.FromArgb(49, 46, 129); // Indigo #312e81
            btnGitPush.ForeColor = Color.FromArgb(224, 231, 255);
            btnGitPush.FlatAppearance.BorderColor = Color.FromArgb(129, 140, 248);
            btnGitPush.Click += (s, e) => RunGitPushFromNotebookAsync();
            mainToolTip.SetToolTip(btnGitPush, "Verifica si tenés commits o avances locales en esta Notebook y te pide confirmación explícita antes de subirlos a 'origin/desarrollo'. (Nunca mezcla con descarga).");
            gitRow.Controls.Add(btnGitPush);

            contentPanel.Controls.Add(gitRow);
            y += 38;

            // 6. Commit Status + Local Lab Utilities Row (DB Restore, Mobile App)
            Panel toolsRow = new Panel();
            toolsRow.Location = new Point(18, y);
            toolsRow.Size = new Size(706, 36);
            toolsRow.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            lblGitCommit = new Label();
            lblGitCommit.Text = "📌 Commit en Notebook: verificando...";
            lblGitCommit.Font = new Font("Consolas", 8.5f, FontStyle.Bold);
            lblGitCommit.ForeColor = Color.FromArgb(125, 211, 252);
            lblGitCommit.Location = new Point(0, 9);
            lblGitCommit.Size = new Size(384, 20);
            lblGitCommit.AutoEllipsis = true;
            toolsRow.Controls.Add(lblGitCommit);

            btnRestoreDb = CreateSmallToolButton("🗄️ Restaurar Base de Pruebas", 392, 2, 192);
            btnRestoreDb.Click += (s, e) => RunRestoreDatabaseAsync();
            mainToolTip.SetToolTip(btnRestoreDb, "Restaura la base PostgreSQL local 'etiquetas_pruebas' desde el último snapshot local.");
            toolsRow.Controls.Add(btnRestoreDb);

            btnOpenMobile = CreateSmallToolButton("📱 Abrir /mobile", 592, 2, 114);
            btnOpenMobile.Click += (s, e) => OpenMobileTab();
            mainToolTip.SetToolTip(btnOpenMobile, "Abre la App Móvil Operativa en http://localhost:3005/mobile/home.html");
            toolsRow.Controls.Add(btnOpenMobile);

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
                        AppendLog("Los 5 servicios ya estaban activos. Abriendo http://localhost:3000 (1 sola pestaña)...");
                        if (chkAutoOpenBrowser.Checked && !browserOpenedForCurrentRun)
                        {
                            browserOpenedForCurrentRun = true;
                            OpenMainBrowserTab();
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
                        svc.IsListening = CheckPortOpen("127.0.0.1", svc.Port, 220);
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
                svc.IsListening = CheckPortOpen("127.0.0.1", svc.Port, 220);
                if (svc.IsListening) count++;
            }
            return count;
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

            if (isStartingSequence && activeCount == services.Count)
            {
                isStartingSequence = false;
                AppendLog("✅ ¡Los 5 servicios del Modo Laboratorio están ACTIVOS y listos!");
                if (chkAutoOpenBrowser.Checked && !browserOpenedForCurrentRun)
                {
                    browserOpenedForCurrentRun = true;
                    OpenMainBrowserTab();
                }
            }

            if (isStartingSequence && (DateTime.Now - startSequenceTimestamp).TotalSeconds > 28)
            {
                isStartingSequence = false;
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
                overallSubLabel.Text = "No hay ningún proceso de LAMDA corriendo en segundo plano (Notebook 100% libre).";
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
            isStartingSequence = true;
            browserOpenedForCurrentRun = false;
            startSequenceTimestamp = DateTime.Now;
            UpdateVisualState();

            Task.Factory.StartNew(() =>
            {
                foreach (var svc in services)
                {
                    bool alreadyUp = CheckPortOpen("127.0.0.1", svc.Port, 200);
                    if (alreadyUp)
                    {
                        svc.IsListening = true;
                        AppendLog(string.Format("[{0}] Puerto {1} ya se encuentra activo.", svc.Key, svc.Port));
                        continue;
                    }

                    StartSingleService(svc);
                    Thread.Sleep(250);
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
                        if (e.Data.Contains("corriendo") || e.Data.Contains("Iniciado") || e.Data.Contains("Escuchando") || e.Data.Contains("puerto") || e.Data.Contains("MODO LABORATORIO"))
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
                        if (!silent) AppendLog("✅ Todos los servicios y la ventana del navegador fueron cerrados. Notebook 100% libre.");
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
                HashSet<int> targetPorts = new HashSet<int> { 3000, 3002, 3003, 3004, 3005 };
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
                    title.Contains("Gestiones LAMDA") ||
                    title.Contains("Sistema de Etiquetas") ||
                    title.Contains("LAMDA Móvil") ||
                    title.Contains("localhost:3000") ||
                    title.Contains("localhost:3005"))
                {
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
                        title.Contains("Gestiones LAMDA") ||
                        title.Contains("Sistema de Etiquetas") ||
                        title.Contains("LAMDA Móvil") ||
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
            }

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("powershell.exe", "-NoProfile -WindowStyle Hidden -Command \"Get-CimInstance Win32_Process -Filter \\\"Name = 'chrome.exe' OR Name = 'msedge.exe'\\\" | Where-Object { $_.CommandLine -like '*LamdaLaboratorioBrowserProfile*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }\"");
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
            bool port3000Up = CheckPortOpen("127.0.0.1", 3000, 250);
            if (!port3000Up)
            {
                AppendLog("⚠️ El puerto 3000 aún está apagado. Encendiendo servicios primero...");
                chkAutoOpenBrowser.Checked = true;
                StartAllServices();
                return;
            }

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
            bool port3005Up = CheckPortOpen("127.0.0.1", 3005, 250);
            if (!port3005Up)
            {
                MessageBox.Show("El servicio de Logística (Puerto 3005) está apagado. Tocá 'Encender Servicios' primero.", "Servicio Apagado", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            AppendLog("📱 Abriendo App Móvil Operativa en http://localhost:3005/mobile/home.html...");
            try
            {
                LaunchInIsolatedBrowser("http://localhost:3005/mobile/home.html", false);
            }
            catch (Exception ex)
            {
                AppendLog("Error al abrir /mobile: " + ex.Message);
            }
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
                RunCliCommand(gitExePath, "checkout -- src/app-etiquetas/documentos", out code);
                RunCliCommand(gitExePath, "checkout -- pagina-publica-web/dist", out code);
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
                    string shortInfo = RunCliCommand(gitExePath, "log -1 --format=\"%h — %s\"", out code).Trim();
                    string fullInfo = RunCliCommand(gitExePath, "log -1 --format=\"Commit %h (%ci): %s\"", out code).Trim();
                    if (string.IsNullOrWhiteSpace(shortInfo)) shortInfo = "desconocido";
                    if (!this.IsDisposed)
                    {
                        this.BeginInvoke(new Action(() =>
                        {
                            lblGitCommit.Text = "📌 Commit en Notebook: " + shortInfo;
                            mainToolTip.SetToolTip(lblGitCommit, fullInfo);
                        }));
                    }
                }
                catch { }
            });
        }

        private void RunGitPullToNotebookAsync()
        {
            SetGitButtonsEnabled(false);
            AppendLog("⬇️ [TRAER ACTUALIZACIONES] Consultando rama 'origin/desarrollo' en GitHub...");
            Task.Factory.StartNew(() =>
            {
                try
                {
                    CleanRuntimeNoiseFiles();

                    // Exportar snapshot automático de esquema de etiquetas_pruebas para detectar tablas/columnas nuevas
                    try
                    {
                        string auditScript = Path.Combine(rootDir, @"scripts\auditarDiferenciasEsquemaDb.js");
                        if (File.Exists(auditScript))
                        {
                            int audCode;
                            RunCliCommand(nodeExePath, "\"" + auditScript + "\" --export-lab", out audCode);
                            int diffSchemaCode;
                            string schemaDiff = RunCliCommand(gitExePath, "status --porcelain migrations/schema_laboratorio_snapshot.json", out diffSchemaCode).Trim();
                            if (!string.IsNullOrWhiteSpace(schemaDiff))
                            {
                                RunCliCommand(gitExePath, "add migrations/schema_laboratorio_snapshot.json", out diffSchemaCode);
                                RunCliCommand(gitExePath, "commit -m \"chore(db-schema): actualizar snapshot de estructura de etiquetas_pruebas\"", out diffSchemaCode);
                            }
                        }
                    }
                    catch { }

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

                    if (string.IsNullOrWhiteSpace(incomingCommits))
                    {
                        int curCode;
                        string currentCommit = RunCliCommand(gitExePath, "log -1 --format=\"%h — %s (%cr)\"", out curCode).Trim();
                        AppendLog("✅ La Notebook ya está al día con 'origin/desarrollo'. Último commit: " + currentCommit);
                        UpdateGitCommitBadgeAsync();
                        this.BeginInvoke(new Action(() =>
                        {
                            SetGitButtonsEnabled(true);
                            MessageBox.Show(
                                "✅ Tu Notebook ya está 100% al día con la rama 'desarrollo' de GitHub.\n\nNo había cambios nuevos para descargar.\n\n📌 Último commit activo en esta Notebook:\n" + currentCommit,
                                "Notebook al Día (Sin Cambios Nuevos)",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Information
                            );
                        }));
                        return;
                    }

                    int statCode;
                    string incomingStat = RunCliCommand(gitExePath, "diff --stat HEAD..origin/desarrollo", out statCode).Trim();

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

                    AppendLog("📥 Descargando commits nuevos hacia la Notebook:\r\n" + incomingCommits);
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
                                "Ocurrió un conflicto o error al intentar aplicar los cambios en la Notebook:\n\n" + pullOut.Trim(),
                                "Error al Traer Actualizaciones",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Error
                            );
                        }));
                        return;
                    }

                    try
                    {
                        string csc = @"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe";
                        string csFile = Path.Combine(rootDir, @"scripts\LamdaControlPanel.cs");
                        string outExe = Path.Combine(rootDir, @"scripts\LamdaControlPanel.exe");
                        string icoFile = Path.Combine(rootDir, @"scripts\lamda-lab.ico");
                        if (File.Exists(csc) && File.Exists(csFile))
                        {
                            int cscCode;
                            RunCliCommand(csc, "/nologo /target:winexe /out:\"" + outExe + "\" /win32icon:\"" + icoFile + "\" \"" + csFile + "\"", out cscCode);
                        }
                    }
                    catch { }
                    UpdateGitCommitBadgeAsync();
                    AppendLog("✅ Actualizaciones aplicadas en la Notebook. Reiniciando los 5 servicios automáticamente...");

                    this.BeginInvoke(new Action(() =>
                    {
                        SetGitButtonsEnabled(true);
                        RestartAllServices();
                        MessageBox.Show(
                            "✅ Se descargaron y aplicaron las actualizaciones de 'origin/desarrollo' en esta Notebook.\n\n" +
                            "📥 Commits traídos:\n" + incomingCommits + "\n\n" +
                            "📂 Resumen de archivos actualizados:\n" + incomingStat + "\n\n" +
                            "🔄 Los 5 servicios del Modo Laboratorio se están reiniciando automáticamente con el código nuevo.",
                            "Actualizaciones Traídas a la Notebook",
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

        private void RunGitPushFromNotebookAsync()
        {
            SetGitButtonsEnabled(false);
            AppendLog("⬆️ [SUBIR AVANCES] Verificando si hay commits o cambios locales en la Notebook para subir...");
            Task.Factory.StartNew(() =>
            {
                try
                {
                    CleanRuntimeNoiseFiles();

                    int fetchCode;
                    RunCliCommand(gitExePath, "fetch origin desarrollo", out fetchCode);

                    int aheadCode;
                    string unpushedCommits = RunCliCommand(gitExePath, "log origin/desarrollo..HEAD --oneline", out aheadCode).Trim();

                    int statusCode;
                    string dirtyTracked = RunCliCommand(gitExePath, "status --porcelain --untracked-files=no", out statusCode).Trim();

                    if (string.IsNullOrWhiteSpace(unpushedCommits) && string.IsNullOrWhiteSpace(dirtyTracked))
                    {
                        int curCode;
                        string currentCommit = RunCliCommand(gitExePath, "log -1 --format=\"%h — %s\"", out curCode).Trim();
                        AppendLog("ℹ️ No hay avances ni commits locales pendientes de subir desde la Notebook.");
                        this.BeginInvoke(new Action(() =>
                        {
                            SetGitButtonsEnabled(true);
                            MessageBox.Show(
                                "ℹ️ No hay commits ni avances locales pendientes de subir desde esta Notebook.\n\n" +
                                "Todo lo que está en tu Notebook ya figura publicado en la rama 'desarrollo' de GitHub.\n\n" +
                                "📌 Commit actual: " + currentCommit,
                                "Sin Avances Pendientes para Subir",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Information
                            );
                        }));
                        return;
                    }

                    if (string.IsNullOrWhiteSpace(unpushedCommits) && !string.IsNullOrWhiteSpace(dirtyTracked))
                    {
                        this.BeginInvoke(new Action(() =>
                        {
                            SetGitButtonsEnabled(true);
                            MessageBox.Show(
                                "Tenés archivos modificados localmente aún sin confirmar (sin commit):\n\n" + dirtyTracked + "\n\n" +
                                "Pedile a Antigravity que revise y confirme el commit antes de subirlo a la rama 'desarrollo'.",
                                "Cambios Locales sin Commit",
                                MessageBoxButtons.OK,
                                MessageBoxIcon.Warning
                            );
                        }));
                        return;
                    }

                    int statCode;
                    string pushStat = RunCliCommand(gitExePath, "diff --stat origin/desarrollo..HEAD", out statCode).Trim();

                    this.BeginInvoke(new Action(() =>
                    {
                        DialogResult confirm = MessageBox.Show(
                            "¿Confirmás subir los siguientes avances desde esta Notebook hacia la rama 'desarrollo' en GitHub?\n\n" +
                            "📤 Commits listos para subir:\n" + unpushedCommits + "\n\n" +
                            "📂 Archivos incluidos:\n" + pushStat,
                            "Confirmar Subida de Avances desde la Notebook",
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
                                        "✅ Los avances de la Notebook se subieron exitosamente a la rama 'desarrollo' en GitHub.\n\n" +
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
                                        "Si hay cambios nuevos en GitHub, tocá primero '⬇️ Traer actualizaciones a la Notebook'.\n\nDetalle:\n" + pushOut.Trim(),
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
            ProcessStartInfo psi = new ProcessStartInfo(exe, args);
            psi.WorkingDirectory = rootDir;
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
