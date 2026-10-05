/**
 * This file defines the Privacy Policy component.
 * It displays the privacy policy for the application.
 */

import React from "react";
import ContactMail from "@mui/icons-material/ContactMail";
import History from "@mui/icons-material/History";
import Lock from "@mui/icons-material/Lock";
import Policy from "@mui/icons-material/Policy";
import Public from "@mui/icons-material/Public";
import Security from "@mui/icons-material/Security";
import Shield from "@mui/icons-material/Shield";
import Update from "@mui/icons-material/Update";
import { Box, Chip, Container, Divider, List, ListItem, ListItemText, Paper, Typography } from "@mui/material";

import "../styles/SpreadEditorPage.css";

const LAST_UPDATED = "October 5, 2026";


/**
 * Represents the Privacy Policy component.
 * @component
 * @returns {JSX.Element} The rendered Privacy Policy component.
 */
const PrivacyPolicy = () =>
{
    return (
        <Container className="page-content" maxWidth="md" sx={{ py: 6 }}>
            <Box sx={{ 
                textAlign: 'center', 
                mb: 5,
                bgcolor: '#667eea',
                borderRadius: 3,
                p: 4,
                color: 'white'
            }}>
                <Shield sx={{ fontSize: 60, mb: 2 }} />
                <Typography variant="h3" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
                    Privacy Policy
                </Typography>
                <Chip 
                    icon={<Update />} 
                    label={`Last updated: ${LAST_UPDATED}`} 
                    sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', fontWeight: 500 }}
                />
            </Box>
            
            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #667eea' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Policy sx={{ fontSize: 32, mr: 2, color: '#667eea' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Local App and Scope
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    CFRU Spread Editor is a locally hosted web app for editing CFRU battle facility spreads.
                    In the standard local setup, your browser connects to an API running on your own computer,
                    not a developer-operated cloud service. There are no user accounts, analytics, tracking
                    cookies, or automatic uploads of your repositories or spread edits to the developers.
                    This policy describes the unmodified app in that setup, not a publicly hosted or modified version.
                </Typography>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #f093fb' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Lock sx={{ fontSize: 32, mr: 2, color: '#f093fb' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Data Used and Stored Locally
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <List>
                    <ListItem>
                        <ListItemText 
                            primary="Browser preferences and unsaved edits"
                            secondary="Browser localStorage remembers repository paths, the selected game, your theme preference, and unsaved spread changes. Paths may contain your operating system username."
                            sx={{ '& .MuiListItemText-primary': { fontWeight: 500 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="Repository data"
                            secondary="The local API reads the CFRU, Dynamic Pokemon Expansion, and Unbound Cloud folders you select to load spreads, configuration, catalogs, learnsets, and artwork. Save Changes writes only the four supported CFRU spread headers; DPE and Unbound Cloud remain read-only references."
                            sx={{ '& .MuiListItemText-primary': { fontWeight: 500 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="Caches, backups, and recovery records"
                            secondary="The API stores parsed source caches, downloaded PokeAPI indexes, original-file backups, and save journals on your computer. It also downloads Smogon sets and analyses from data.pkmn.cc and saves them under cache/smogon in the data folder. The default data folder is %LOCALAPPDATA%/CFRU Spread Editor on Windows or ~/.cfru-spread-editor on macOS and Linux, unless SPREAD_EDITOR_DATA_DIR overrides it."
                            sx={{ '& .MuiListItemText-primary': { fontWeight: 500 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="ZIP imports and exports"
                            secondary="Upload ZIP sends your chosen archive to your local API, which keeps extracted repository inputs in its local data folder. Edits are saved to that imported copy, not the original ZIP. Download ZIP creates a file containing repository inputs for you to keep or share; inspect it before sharing source data."
                            sx={{ '& .MuiListItemText-primary': { fontWeight: 500 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="Showdown text and session access"
                            secondary="Pasted Showdown text is processed locally. Copy and download actions place exported text on your clipboard or in a file you choose to share. Local API session tokens are held in memory and are not account credentials."
                            sx={{ '& .MuiListItemText-primary': { fontWeight: 500 } }}
                        />
                    </ListItem>
                </List>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #4facfe' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Public sx={{ fontSize: 32, mr: 2, color: '#4facfe' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Third-Party Services
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    Local hosting does not mean every feature is offline. The API may request public
                    Pokemon and type indexes from pokeapi.co, and Smogon sets and analyses from
                    data.pkmn.cc (which redirects to GitHub Pages). Smogon requests send only format
                    file names, not personal data, selected species, or spread edits. Your browser may load artwork from
                    raw.githubusercontent.com (PokeAPI sprites and PokeSprite) and move category icons
                    from play.pokemonshowdown.com. Local repository artwork is also used when available.
                </Typography>
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    These providers receive normal network request information, such as your public IP
                    address and the requested resource; browser requests may also include browser or referrer
                    information according to your browser settings. Artwork URLs can identify the species,
                    item, or icon requested. The app does not send repository files, local paths, or spread
                    edits to these providers. Their own privacy policies apply to those requests.
                </Typography>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #43e97b' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Security sx={{ fontSize: 32, mr: 2, color: '#43e97b' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Data Security
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    The API binds to the loopback address and checks local hosts, allowed browser origins,
                    and session tokens for protected requests. These safeguards are intended for use on
                    your own computer, not public hosting or shared-user access. Do not expose the app through
                    port forwarding, public tunnels, or a LAN server. Local data is not encrypted by the app;
                    protect it with operating system permissions and your own backup practices.
                </Typography>
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    To remove browser preferences and cached drafts, clear this site's browser storage after
                    saving any work you need. To remove API caches, imported copies, backups, and journals,
                    stop the app and remove the relevant data from its local data folder. Preserve needed
                    backups and resolve interrupted saves first. Clearing browser storage does not remove
                    API data, repository edits, downloaded ZIPs, or exported text files; manage those separately.
                </Typography>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #fa709a' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <History sx={{ fontSize: 32, mr: 2, color: '#fa709a' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Changes to This Policy
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    This policy may change as the app's storage or network behavior changes. Updates are
                    included with the app version you install and are reflected in the date above.
                </Typography>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #667eea', bgcolor: 'action.hover' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <ContactMail sx={{ fontSize: 32, mr: 2, color: '#667eea' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Contact
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    Raise questions with the maintainers through the source repository's issue tracker.
                    Issues and attachments may be public. Remove personal paths, private source data, and
                    local session tokens before sharing screenshots, logs, or archives.
                </Typography>
            </Paper>
        </Container>
    );
};

export default PrivacyPolicy;
