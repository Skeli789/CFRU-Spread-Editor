const express = require('express');
const path = require('path');
// Must load before the middleware, which reads CLIENT_ORIGINS on import
require('dotenv').config({ path: __dirname + '/.env' });

const repositoriesRouter = require('./endpoints/repositories');
const sessionRouter = require('./endpoints/session');
const workspacesRouter = require('./endpoints/workspaces');

const { handleErrors, handleUnknownApiRoute } = require('./middleware/errors');
const
{
    allowEditorOriginsOnly, allowLocalHostsOnly, editorCors, parseJsonBody,
    requireJsonBody, requireObjectBody, requireSession,
} = require('./middleware/security');

const PORT = process.env.PORT || 3001;
const LOOPBACK_HOST = '127.0.0.1';
const buildPath = path.join(__dirname, '..', 'build');

const app = express();
const http = require('http').Server(app);

// Local-only access and JSON bodies for every request
app.use(allowLocalHostsOnly);
app.use(allowEditorOriginsOnly);
app.use(editorCors);
app.use(requireJsonBody);
app.use(parseJsonBody);
app.use(requireObjectBody);
// app.use(express.static(buildPath)); // Uncomment for production server

// The session route issues the token that every later API route requires
app.use('/api/session', sessionRouter);
app.use('/api', requireSession);
app.use('/api/repositories', repositoriesRouter);
app.use('/api/workspaces', workspacesRouter);
// Add more endpoint routers here as needed

// Error responses
app.use('/api', handleUnknownApiRoute);
app.use(handleErrors);

// Start the server only if this file is run directly
if (require.main === module)
{
    http.listen(PORT, LOOPBACK_HOST, () =>
    {
        console.log(`CFRU Spread Editor server listening on http://${LOOPBACK_HOST}:${PORT}`);
    });
}

// Production Server Routing //

// Needed so routing works correctly.
// Uncomment for production server
/**
 * Endpoint: /*
 * @route GET /*
 * @returns {File} index.html - The main HTML file for the React app
 */
/*app.get('/{*splat}', function (req, res)
{
    res.sendFile(path.join(buildPath, "index.html"));
});*/

module.exports = { app, http };
