/**
 * This file defines the Terms of Service component.
 * It displays the terms of service for the application.
 */

import React from "react";
import Block from "@mui/icons-material/Block";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Cloud from "@mui/icons-material/Cloud";
import ContactMail from "@mui/icons-material/ContactMail";
import Description from "@mui/icons-material/Description";
import Gavel from "@mui/icons-material/Gavel";
import History from "@mui/icons-material/History";
import Info from "@mui/icons-material/Info";
import Update from "@mui/icons-material/Update";
import Warning from "@mui/icons-material/Warning";
import { Box, Chip, Container, Divider, List, ListItem, ListItemText, Paper, Typography } from "@mui/material";

import "../styles/SpreadEditorPage.css";

const LAST_UPDATED = "October 1, 2026";


/**
 * Represents the Terms of Service component.
 * @component
 * @returns {JSX.Element} The rendered Terms of Service component.
 */
const TermsOfService = () =>
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
                <Gavel sx={{ fontSize: 60, mb: 2 }} />
                <Typography variant="h3" component="h1" gutterBottom sx={{ fontWeight: 700 }}>
                    Terms of Service
                </Typography>
                <Chip 
                    icon={<Update />} 
                    label={`Last updated: ${LAST_UPDATED}`} 
                    sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: 'white', fontWeight: 500 }}
                />
            </Box>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #f093fb' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <CheckCircle sx={{ fontSize: 32, mr: 2, color: '#f093fb' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Acceptance of Terms
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    These terms describe use of CFRU Spread Editor as a locally hosted tool on your own
                    computer. By using the app, you accept these terms. If you do not accept them, stop
                    using it. There is no hosted account, subscription, or developer-operated storage service.
                </Typography>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #667eea' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Description sx={{ fontSize: 32, mr: 2, color: '#667eea' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Service Description
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    CFRU Spread Editor loads regular battle facility, special trainer, multi partner, and
                    raid partner spreads from Complete Fire Red Upgrade (CFRU). It uses Dynamic Pokemon
                    Expansion (DPE) and Unbound Cloud as read-only sources for game data, learnsets, and artwork.
                    It supports editing, adding, deleting, reordering, Showdown text exchange, and repository
                    input ZIP exchange. Save Changes writes the four supported CFRU spread headers, not a
                    compiled game or ROM. Imported ZIP workspaces save to a local extracted copy; export a
                    new ZIP to carry those edits elsewhere.
                </Typography>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #43e97b' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <CheckCircle sx={{ fontSize: 32, mr: 2, color: '#43e97b' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Your Repositories and Responsibilities
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    You control the repositories, imported files, and edits processed by your local instance.
                    Before saving or sharing data:
                </Typography>
                <List>
                    <ListItem>
                        <ListItemText 
                            primary="Use Authorized Sources"
                            secondary="Select or import only repositories and files you are entitled to access, modify, and use. Follow applicable laws and the licenses of the source projects and assets."
                            slotProps={{ primary: { fontWeight: 600 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="Match Your Game Configuration"
                            secondary="Choose the game that matches your CFRU build and review Load Warnings. Catalog checks, move legality, and stat previews are aids, not a guarantee of compatibility with your particular checkout."
                            slotProps={{ primary: { fontWeight: 600 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="Review and Test Changes"
                            secondary="Inspect source diffs, compile your project, and test the resulting game. Avoid concurrent external edits while saving and resolve conflicts before retrying. The editor does not compile or test your game for you."
                            slotProps={{ primary: { fontWeight: 600 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="Share Deliberately"
                            secondary="Inspect exported ZIPs, Showdown text, screenshots, and logs before sharing them. You are responsible for any source code, assets, or private information you distribute."
                            slotProps={{ primary: { fontWeight: 600 } }}
                        />
                    </ListItem>
                </List>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #ff6b6b', bgcolor: (theme) => theme.palette.mode === 'dark' ? 'background.paper' : '#fff5f5' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Block sx={{ fontSize: 32, mr: 2, color: '#ff6b6b' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600, color: '#ff6b6b' }}>
                        Local Hosting and Safe Use
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    This app is intended for a trusted user on their own computer. Its local session token
                    is a request safeguard, not a multi-user login or a public-hosting security system.
                </Typography>
                <List>
                    <ListItem>
                        <ListItemText 
                            primary="Keep the browser app and API local; do not expose them through a public tunnel, port forwarding, or a LAN service."
                            slotProps={{ primary: { fontWeight: 500 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="Do not bypass path validation, origin checks, or session safeguards to access another person's files or computer."
                            slotProps={{ primary: { fontWeight: 500 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="Import ZIPs only from sources you trust and keep your runtime and dependencies up to date."
                            slotProps={{ primary: { fontWeight: 500 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="Respect third-party artwork and data providers; do not use the app to abuse their services."
                            slotProps={{ primary: { fontWeight: 500 } }}
                        />
                    </ListItem>
                    <ListItem>
                        <ListItemText 
                            primary="If you modify or host a different version, you are responsible for its security and for accurately describing its data practices."
                            slotProps={{ primary: { fontWeight: 500 } }}
                        />
                    </ListItem>
                </List>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #ffa502' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Warning sx={{ fontSize: 32, mr: 2, color: '#ffa502' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Backups and Data Loss
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    Saving changes modifies source files on your computer. The app creates original-file
                    backups and save journals and attempts recovery from interrupted saves, but these are
                    not a substitute for Git commits or independent backups. Preserve your own copies before
                    editing. Unsaved browser drafts and imported workspaces can be lost if local storage is
                    cleared or the app's data folder is removed. Stopping or uninstalling the app does not
                    automatically undo repository edits or delete exported files.
                </Typography>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #4facfe' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Cloud sx={{ fontSize: 32, mr: 2, color: '#4facfe' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Availability and External Resources
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    Availability depends on your local browser, API process, filesystem permissions,
                    repository contents, and installed dependencies. There is no hosted uptime commitment
                    or guaranteed support. Some indexes and artwork are requested from PokeAPI, GitHub-hosted
                    sprite projects, and Pokemon Showdown; those resources may be unavailable or change
                    independently. See the Privacy Policy for local storage and external request details.
                </Typography>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #a29bfe' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Info sx={{ fontSize: 32, mr: 2, color: '#a29bfe' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Disclaimer and Limitation of Liability
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    To the extent permitted by applicable law, the app is provided "as is" and "as available",
                    without warranties of accuracy, fitness for a particular purpose, or uninterrupted operation.
                    The maintainers and contributors are not liable for losses arising from use of the app,
                    including lost edits, damaged source files, failed builds, or incorrect game behavior.
                    Nothing in these terms excludes rights or liabilities that applicable law does not allow
                    to be excluded.
                </Typography>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #43e97b' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <Description sx={{ fontSize: 32, mr: 2, color: '#43e97b' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Software License and Third-Party Rights
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    The editor's package metadata identifies its software license as MIT. These terms do
                    not replace or restrict rights granted by the applicable software license. Dependencies,
                    connected repositories, game data, and artwork remain subject to their own licenses
                    and owners' rights. Using or exporting them through this app grants no additional rights.
                    Pokemon names and related assets belong to their respective owners; this editor is not
                    an official Nintendo, Game Freak, or The Pokemon Company product.
                </Typography>
            </Paper>

            <Paper elevation={3} sx={{ p: 4, mb: 3, borderLeft: '4px solid #fd79a8' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
                    <History sx={{ fontSize: 32, mr: 2, color: '#fd79a8' }} />
                    <Typography variant="h5" component="h2" sx={{ fontWeight: 600 }}>
                        Changes to Terms
                    </Typography>
                </Box>
                <Divider sx={{ mb: 2 }} />
                <Typography variant="body1" component="p" sx={{ lineHeight: 1.8, mb: 2 }}>
                    Terms may be updated with future app versions, with the revision date shown above.
                    Review them when updating. You can stop using the app at any time by stopping its
                    local processes; there is no account to close.
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
                    Direct questions and bug reports to the maintainers through the source repository's
                    issue tracker. Do not include private repository contents, personal paths, or session
                    tokens in public reports. Support and response times are not guaranteed.
                </Typography>
            </Paper>
        </Container>
    );
};

export default TermsOfService;
