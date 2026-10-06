const express = require('express');
const path = require('path');
// Must load before the middleware, which reads CLIENT_ORIGINS on import
require('dotenv').config({ path: __dirname + '/.env' });

const healthRouter = require('./endpoints/health');
const imagesRouter = require('./endpoints/images');
const repositoriesRouter = require('./endpoints/repositories');
const sessionRouter = require('./endpoints/session');
const workspacesRouter = require('./endpoints/workspaces');
const archiveImportRouter = require('./endpoints/archive-import');
const progressRouter = require('./endpoints/progress');
const smogonRouter = require('./endpoints/smogon');

const { handleErrors, handleUnknownApiRoute } = require('./middleware/errors');
const
{
    allowEditorOriginsOnly, allowLocalHostsOnly, editorCors, parseJsonBody,
    requireJsonBody, requireObjectBody, requireSession,
} = require('./middleware/security');

const PORT = process.env.PORT || 3001;
const buildPath = path.join(__dirname, '..', 'build');

const app = express();
const http = require('http').Server(app);

// Local-only access and JSON bodies for every request
app.use(allowLocalHostsOnly);
app.use(allowEditorOriginsOnly);
app.use(editorCors);
app.use(archiveImportRouter); // Only the exact authenticated import POST parses binary data before the JSON guards
app.use(requireJsonBody);
app.use(parseJsonBody);
app.use(requireObjectBody);
// app.use(express.static(buildPath)); // Uncomment for production server

app.use('/api/health', healthRouter);
app.use('/api/session', sessionRouter); // The session route issues the token that every later API route requires; images cannot send it
app.use('/api/images', imagesRouter);
app.use('/api', requireSession);
app.use('/api/progress', progressRouter);
app.use('/api/repositories', repositoriesRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/smogon', smogonRouter);
// Add more endpoint routers here as needed

// Error responses
app.use('/api', handleUnknownApiRoute);
app.use(handleErrors);

// Start the server only if this file is run directly
if (require.main === module)
{
    http.listen(PORT, () =>
    {
        console.log(`CFRU Spread Editor server listening on port ${PORT}`);
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
