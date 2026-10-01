# CETNova LAN Development

LAN mode is for local development only. It exposes the Vite development server to devices on the same local network; never expose it directly to the public Internet.

## Start the servers

Open two PowerShell terminals from the repository folder.

Terminal 1, start the API:

```powershell
cd cet-api
npm run dev
```

The API uses `PORT` from `cet-api/.env`, or defaults to `5000`. It listens on `0.0.0.0`; if the selected port is busy, it retries on the next port and reports the effective port. If that happens, set `PORT` in `cet-api/.env` to a free port and set `VITE_API_URL` in `cet-prep-pro/.env.lan` to `http://localhost:<port>`, then restart both servers.

Terminal 2, start the frontend:

```powershell
cd cet-prep-pro
npm run dev:lan
```

The frontend uses Vite's default port `5173` and prints its Local and Network URLs. If `5173` is already in use, Vite selects another port; use the Network URL it prints. Development API requests use the same frontend origin and are forwarded by Vite to the API.

## API target

The default API target is `http://localhost:5000`. To select another API port, copy `cet-prep-pro/.env.lan.example` to `cet-prep-pro/.env.lan` and set `VITE_API_URL` to the API server address, for example `http://localhost:5001`. Vite loads this file in LAN mode. The frontend does not call a hard-coded laptop IP, and its API traffic remains same-origin in the browser.

Keep backend secrets in `cet-api/.env`. Do not put Supabase service-role keys or private API keys in frontend environment files. Never commit `.env` files containing secrets.

## Connect another device

1. Run `ipconfig` on the laptop and find the IPv4 Address under the active Wi-Fi adapter. Do not use a VMware, Ethernet, or disconnected adapter address.
2. Make sure the laptop and phone/tablet are connected to the same Wi-Fi/router.
3. Open the Vite Network URL shown in the frontend terminal on the other device. For this laptop's current Wi-Fi address, the usual URL is `http://10.94.221.207:5173`; confirm the port from Vite's output.
4. Sign in and use the app normally. Frontend API requests are sent through Vite to the local API.

Some college, public, or guest Wi-Fi networks block communication between connected devices. In that case, use a trusted private network or hotspot. The laptop's firewall may also need to allow inbound TCP traffic to the frontend and API ports.

## Windows Firewall (manual)

Run PowerShell as Administrator only if Windows prompts that elevated permission is needed. Replace the ports below if Vite or the API reports different ports.

```powershell
netsh advfirewall firewall add rule name="CETNova Frontend LAN" dir=in action=allow protocol=TCP localport=5173
netsh advfirewall firewall add rule name="CETNova API LAN" dir=in action=allow protocol=TCP localport=5000
```

Remove the rules later with:

```powershell
netsh advfirewall firewall delete rule name="CETNova Frontend LAN"
netsh advfirewall firewall delete rule name="CETNova API LAN"
```

## Security and production

- LAN mode makes the development server reachable to other devices on the local network. Use a network you trust and do not port-forward these development ports or expose them to the public Internet.
- The API allows HTTP origins from private IPv4 ranges only in non-production mode. Production CORS remains restricted to its configured production origins.
- Development auth cookies are not marked `Secure` so they work over local HTTP. Production cookie and API URL behavior are unchanged.
- Never expose Supabase service-role keys or private API keys in frontend JavaScript.
- Production deployments do not use the Vite LAN development command or its proxy configuration.