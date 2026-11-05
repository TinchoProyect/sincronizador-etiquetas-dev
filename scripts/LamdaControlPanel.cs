using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Sockets;
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
        private Button btnGitSync;
        private Button btnRestoreDb;
        private Button btnOpenMobile;
        private RichTextBox logBox;

        public MainForm()
        {
            ResolvePaths();
            InitializeServicesList();
            BuildUserInterface();

            uiTimer = new System.Windows.Forms.Timer();
            uiTimer.Interval = 1000;
            uiTimer.Tick += UiTimer_Tick;
            uiTimer.Start();

            this.Shown += MainForm_Shown;
            this.FormClosing += MainForm_FormClosing;
        }

        private void ResolvePaths()
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

            if (!File.Exists(Path.Combine(rootDir, "package.json")))
            {
                string fallback = @"C:\Users\Martin\Downloads\LAMDA-Desarrollo";
                if (Directory.Exists(fallback)) rootDir = fallback;
            }

            nodeExePath = @"C:\Program Files\nodejs\node.exe";
            if (!File.Exists(nodeExePath)) nodeExePath = "node";

            gitExePath = @"C:\Program Files\Git\cmd\git.exe";
            if (!File.Exists(gitExePath)) gitExePath = "git";
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
            this.Size = new Size(760, 720);
            this.MinimumSize = new Size(740, 680);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(15, 23, 42); // #0f172a
            this.ForeColor = Color.FromArgb(248, 250, 252);
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

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

            // 5. Quick Lab Tools Row (Git Sync, DB Restore, Mobile App)
            Panel toolsRow = new Panel();
            toolsRow.Location = new Point(18, y);
            toolsRow.Size = new Size(706, 36);
            toolsRow.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;

            Label toolsLabel = new Label();
            toolsLabel.Text = "Herramientas de Laboratorio:";
            toolsLabel.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            toolsLabel.ForeColor = Color.FromArgb(148, 163, 184);
            toolsLabel.Location = new Point(0, 8);
            toolsLabel.AutoSize = true;
            toolsRow.Controls.Add(toolsLabel);

            btnGitSync = CreateSmallToolButton("☁️ Sincronizar Git (desarrollo)", 182, 0, 205);
            btnGitSync.Click += (s, e) => RunGitSyncAsync();
            toolsRow.Controls.Add(btnGitSync);

            btnRestoreDb = CreateSmallToolButton("🗄️ Restaurar Base de Pruebas", 395, 0, 190);
            btnRestoreDb.Click += (s, e) => RunRestoreDatabaseAsync();
            toolsRow.Controls.Add(btnRestoreDb);

            btnOpenMobile = CreateSmallToolButton("📱 Abrir /mobile", 593, 0, 113);
            btnOpenMobile.Click += (s, e) => OpenMobileTab();
            toolsRow.Controls.Add(btnOpenMobile);

            contentPanel.Controls.Add(toolsRow);
            y += 42;

            // 6. Live Log Viewer
            logBox = new RichTextBox();
            logBox.Location = new Point(18, y);
            logBox.Size = new Size(706, 122);
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
            if (!silent) AppendLog("⏹ Deteniendo todos los servicios de LAMDA (puertos 3000 a 3005)...");
            isStartingSequence = false;
            isStoppingSequence = true;

            Task.Factory.StartNew(() =>
            {
                StopAllServicesSync();
                isStoppingSequence = false;
                CountListeningPortsSync();
                if (!this.IsDisposed)
                {
                    this.BeginInvoke(new Action(() =>
                    {
                        UpdateVisualState();
                        if (!silent) AppendLog("✅ Todos los servicios fueron apagados. La Notebook quedó 100% libre.");
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

            AppendLog("🌐 Abriendo navegador en http://localhost:3000 (1 sola pestaña)...");
            try
            {
                Process.Start("http://localhost:3000");
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
                Process.Start("http://localhost:3005/mobile/home.html");
            }
            catch (Exception ex)
            {
                AppendLog("Error al abrir /mobile: " + ex.Message);
            }
        }

        private void RunGitSyncAsync()
        {
            btnGitSync.Enabled = false;
            AppendLog("☁️ Sincronizando rama 'desarrollo' con GitHub...");
            Task.Factory.StartNew(() =>
            {
                try
                {
                    string pullOut = RunCliCommand(gitExePath, "pull --rebase origin desarrollo");
                    AppendLog("[GIT PULL] " + pullOut.Trim());
                    string pushOut = RunCliCommand(gitExePath, "push origin desarrollo");
                    AppendLog("[GIT PUSH] " + pushOut.Trim());
                    this.BeginInvoke(new Action(() =>
                    {
                        btnGitSync.Enabled = true;
                        MessageBox.Show("Sincronización con la rama 'desarrollo' en GitHub completada correctamente.", "Git Sincronizado", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }));
                }
                catch (Exception ex)
                {
                    this.BeginInvoke(new Action(() =>
                    {
                        btnGitSync.Enabled = true;
                        AppendLog("ERROR Git: " + ex.Message);
                    }));
                }
            });
        }

        private void RunRestoreDatabaseAsync()
        {
            DialogResult dr = MessageBox.Show(
                "¿Querés restaurar la base local 'etiquetas_pruebas' desde el último backup?\n\nEsto reiniciará los datos de prueba locales sin tocar ninguna otra base de tu Notebook.",
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
                    string scriptPath = Path.Combine(rootDir, @"scripts\restaurar-db-pruebas.js");
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
                return stdout + (string.IsNullOrWhiteSpace(stderr) ? "" : ("\r\n" + stderr));
            }
        }

        private void MainForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            uiTimer.Stop();
            StopAllServicesSync();
        }

        [STAThread]
        public static void Main()
        {
            bool createdNew;
            using (Mutex mutex = new Mutex(true, "Global\\LamdaModoLaboratorioControlPanelMutex", out createdNew))
            {
                if (!createdNew)
                {
                    MessageBox.Show("El Panel de Control de LAMDA (Modo Laboratorio) ya se encuentra abierto en tu barra de tareas.", "LAMDA Modo Laboratorio", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
        }
    }
}
