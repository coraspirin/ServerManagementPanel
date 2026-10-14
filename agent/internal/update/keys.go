package update

// TrustedKeys — güncelleme imzasını doğrulayan Ed25519 ortak anahtarları
// (ham 32 bayt, base64; virgülle birden çok — anahtar değişiminde eski ve
// yeni birlikte durur). Özel anahtar yalnız GitHub Actions sırrı
// AGENT_SIGNING_KEY'de (2026-10-14 üretildi). install-agent.sh'taki PEM ile
// aynı anahtar.
const TrustedKeys = "2CbjyZxXu+HyB+Gy3kVMeVHT9rF+uKvmWB6b7YT1JPU="
