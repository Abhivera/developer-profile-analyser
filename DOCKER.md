# Docker Setup & Usage

This project uses Docker to containerize the application, its worker process, and the Redis database it depends on. The setup uses Docker mode for crawling with `unclecode/crawl4ai:0.8`.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Environment Variables

The Docker setup relies on environment variables from a `.env` file. 

Before running the containers, ensure you have a `.env` file in the root directory. You can create one by copying the example:

```bash
cp .env.example .env
```

Make sure to configure necessary API keys (like `GROQ_API_KEY`) in your `.env` file. The `REDIS_URL` is automatically managed in the docker-compose setup and pointed to the internal Redis container.

## Architecture

The `docker-compose.yml` defines three services:

1. **redis**: A standard `redis:7-alpine` container used for job queuing (BullMQ).
2. **app**: The main web application (Node.js/Express) running on port `3000`.
3. **worker**: A background worker process that processes the Redis queues and invokes the crawl4ai Docker image.

Both `app` and `worker` use the same underlying Docker image built from the `Dockerfile` (`node:22-bookworm-slim`).
In this repo's compose configuration, build arg `CRAWL_RUNTIME=docker` is used, so heavy local Python/Playwright apt installs are skipped to speed up builds.

## Crawl4ai Image Version

The project is configured to use:

```bash
unclecode/crawl4ai:0.8
```

You can pull it manually:

```bash
npm run crawl4ai:pull
```

## Common Commands

### Start the Application
To build and start all services in the background (detached mode):
```bash
docker compose up -d --build
```
*Note: The `--build` flag ensures that any recent code changes are built into the image before starting.*

### View Logs
To view logs from all services:
```bash
docker compose logs -f
```
To view logs for a specific service (e.g., the worker):
```bash
docker compose logs -f worker
```

### Stop the Application
To stop all running services:
```bash
docker compose stop
```
To stop and completely remove the containers, networks, and volumes (useful for a fresh start):
```bash
docker compose down
```

### Rebuilding the Image
If you make changes to `package.json`, `requirements-crawl.txt`, or any source files, you should rebuild the image:
```bash
docker compose build
```

## Accessing the Application

Once running, the web application will be accessible at:
[http://localhost:3000](http://localhost:3000)

The Redis instance is exposed on `localhost:6379` if you need to inspect the queues using a local Redis GUI (like RedisInsight) on your host machine.
