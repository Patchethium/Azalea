// Self-Signed TLS Workaround for Tauri Gateway Client
// Add to reqwest::Client builder in connect_gateway command
//
// File: src-tauri/src/lib.rs
// Function: connect_gateway
//
// PURPOSE: Allow connections to Hermes Gateway with self-signed certificates
// (common in local/development deployments like 10.1.1.215:8642)

let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(10))
    .danger_accept_invalid_certs(true)   // ← THIS LINE
    .build()
    .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

// SECURITY NOTE:
// Only use in controlled environments (LAN, VPN, trusted self-hosted)
// For production, use valid TLS certificates (Let's Encrypt, mkcert, etc.)

// ALTERNATIVE (more secure): Pin specific certificate
// .add_root_certificate(reqwest::Certificate::from_pem(include_bytes!("ca.pem"))?)