use std::{net::SocketAddr, sync::Arc, time::Duration};

use foxmapper_server::{rate_limit::RateLimiter, router, spawn_listener, store, AppState};
use sqlx::postgres::PgPoolOptions;
use tokio::sync::broadcast;
use tower_http::trace::TraceLayer;

const PURGE_INTERVAL: Duration = Duration::from_secs(60 * 60);

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "foxmapper_server=info,tower_http=info".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL")?;
    let bind_addr: SocketAddr = std::env::var("BIND_ADDR")
        .unwrap_or_else(|_| "0.0.0.0:8080".into())
        .parse()?;

    let pool = PgPoolOptions::new()
        .max_connections(16)
        .connect(&database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let (notify_tx, _) = broadcast::channel(1024);
    spawn_listener(database_url.clone(), notify_tx.clone(), None);
    store::purge::spawn(pool.clone(), PURGE_INTERVAL);

    let state = AppState {
        pool,
        notify_tx,
        rate_limiter: Arc::new(RateLimiter::default()),
    };

    // Serve the PWA alongside the API when a build is present. In development the two run apart
    // (Vite proxies /api), so its absence is normal rather than an error.
    let mut app = router(state);
    if let Ok(dir) = std::env::var("WEB_DIR") {
        if std::path::Path::new(&dir).is_dir() {
            tracing::info!(%dir, "serving the app");
            app = foxmapper_server::with_static(app, &dir);
        } else {
            tracing::warn!(%dir, "WEB_DIR is set but missing; serving the API only");
        }
    }

    let app = app.layer(TraceLayer::new_for_http());
    let listener = tokio::net::TcpListener::bind(bind_addr).await?;
    tracing::info!(%bind_addr, "relay listening");

    // into_make_service_with_connect_info: the append rate limit keys on the peer IP, and there is
    // nothing else to key on — there are no accounts.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutting down");
}
