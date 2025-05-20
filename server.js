
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const app = express();

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Create necessary directories if they don't exist
const uploadDir = path.join(__dirname, 'public', 'uploads');
const dataDir = path.join(__dirname, 'data');

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

// Copy default images if they don't exist
const defaultImages = [
    { name: 'default-cover.jpg', url: 'https://via.placeholder.com/800x400?text=Default+Cover' },
    { name: 'default-profile.jpg', url: 'https://via.placeholder.com/200x200?text=Profile' },
    { name: 'default-comment-profile.jpg', url: 'https://via.placeholder.com/100x100?text=User' }
];

async function downloadDefaultImages() {
    for (const image of defaultImages) {
        const imagePath = path.join(uploadDir, image.name);
        if (!fs.existsSync(imagePath)) {
            try {
                const response = await axios({
                    method: 'get',
                    url: image.url,
                    responseType: 'stream'
                });
                response.data.pipe(fs.createWriteStream(imagePath));
                console.log(`Downloaded ${image.name}`);
            } catch (error) {
                console.error(`Failed to download ${image.name}:`, error.message);
            }
        }
    }
}

downloadDefaultImages();

// Setup multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, file.fieldname + '-' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: function(req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = filetypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Only image files are allowed!'));
        }
    }
});

// Data file paths
const storiesFilePath = path.join(dataDir, 'stories.json');
const commentsFilePath = path.join(dataDir, 'comments.json');

// Initialize data files if they don't exist
if (!fs.existsSync(storiesFilePath)) {
    fs.writeFileSync(storiesFilePath, JSON.stringify([]));
}

if (!fs.existsSync(commentsFilePath)) {
    fs.writeFileSync(commentsFilePath, JSON.stringify([]));
}

// Helper functions for reading/writing data
function readStoriesData() {
    const data = fs.readFileSync(storiesFilePath);
    return JSON.parse(data);
}

function writeStoriesData(data) {
    fs.writeFileSync(storiesFilePath, JSON.stringify(data, null, 2));
}

function readCommentsData() {
    const data = fs.readFileSync(commentsFilePath);
    return JSON.parse(data);
}

function writeCommentsData(data) {
    fs.writeFileSync(commentsFilePath, JSON.stringify(data, null, 2));
}

// Helper function to download image from URL
async function downloadImage(url, filename) {
    try {
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream'
        });
        
        const filePath = path.join(uploadDir, filename);
        const writer = fs.createWriteStream(filePath);
        
        response.data.pipe(writer);
        
        return new Promise((resolve, reject) => {
            writer.on('finish', () => resolve(path.join('/uploads', filename)));
            writer.on('error', reject);
        });
    } catch (error) {
        console.error('Error downloading image:', error);
        throw new Error('Failed to download image');
    }
}

// Routes

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/story.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'story.html'));
});

// API Routes

// Get all stories
app.get('/api/stories', (req, res) => {
    try {
        const stories = readStoriesData();
        res.json(stories);
    } catch (error) {
        console.error('Error getting stories:', error);
        res.status(500).json({ message: 'Failed to retrieve stories' });
    }
});

// Get a specific story
app.get('/api/stories/:id', (req, res) => {
    try {
        const stories = readStoriesData();
        const story = stories.find(s => s.id === req.params.id);
        
        if (!story) {
            return res.status(404).json({ message: 'Story not found' });
        }
        
        res.json(story);
    } catch (error) {
        console.error('Error getting story:', error);
        res.status(500).json({ message: 'Failed to retrieve story' });
    }
});

// Upload a new story
app.post('/api/stories', upload.fields([
    { name: 'imageFile', maxCount: 1 },
    { name: 'profileFile', maxCount: 1 }
]), async (req, res) => {
    try {
        // Get form data
        const { title, genre, content, author, imageUrl, profileUrl } = req.body;
        
        // Validate required fields
        if (!title || !genre || !content || !author) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        
        // Process story cover image
        let finalImageUrl = '/uploads/default-cover.jpg';
        
        if (req.files && req.files.imageFile && req.files.imageFile[0]) {
            // Use uploaded file
            finalImageUrl = `/uploads/${req.files.imageFile[0].filename}`;
        } else if (imageUrl) {
            // Download from URL
            try {
                const filename = `story-cover-${Date.now()}${path.extname(imageUrl) || '.jpg'}`;
                finalImageUrl = await downloadImage(imageUrl, filename);
            } catch (error) {
                console.error('Error downloading story image:', error);
                // Use default if download fails
            }
        }
        
        // Process profile image
        let finalProfileUrl = '/uploads/default-profile.jpg';
        
        if (req.files && req.files.profileFile && req.files.profileFile[0]) {
            // Use uploaded file
            finalProfileUrl = `/uploads/${req.files.profileFile[0].filename}`;
        } else if (profileUrl) {
            // Download from URL
            try {
                const filename = `profile-${Date.now()}${path.extname(profileUrl) || '.jpg'}`;
                finalProfileUrl = await downloadImage(profileUrl, filename);
            } catch (error) {
                console.error('Error downloading profile image:', error);
                // Use default if download fails
            }
        }
        
        // Create story object
        const newStory = {
            id: uuidv4(),
            title,
            genre,
            content,
            author,
            imageUrl: finalImageUrl,
            profileUrl: finalProfileUrl,
            createdAt: new Date().toISOString()
        };
        
        // Add to stories data
        const stories = readStoriesData();
        stories.push(newStory);
        writeStoriesData(stories);
        
        res.status(201).json(newStory);
    } catch (error) {
        console.error('Error uploading story:', error);
        res.status(500).json({ message: 'Failed to upload story' });
    }
});

// Get comments for a story
app.get('/api/comments/:storyId', (req, res) => {
    try {
        const comments = readCommentsData();
        const storyComments = comments.filter(c => c.storyId === req.params.storyId);
        res.json(storyComments);
    } catch (error) {
        console.error('Error getting comments:', error);
        res.status(500).json({ message: 'Failed to retrieve comments' });
    }
});

// Add a comment
app.post('/api/comments', (req, res) => {
    try {
        const { storyId, name, text } = req.body;
        
        // Validate required fields
        if (!storyId || !name || !text) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        
        // Create comment object
        const newComment = {
            id: uuidv4(),
            storyId,
            name,
            text,
            createdAt: new Date().toISOString()
        };
        
        // Add to comments data
        const comments = readCommentsData();
        comments.push(newComment);
        writeCommentsData(comments);
        
        res.status(201).json(newComment);
    } catch (error) {
        console.error('Error adding comment:', error);
        res.status(500).json({ message: 'Failed to add comment' });
    }
});

// Copy HTML files to public directory
function copyHtmlFiles() {
    const files = ['index.html', 'story.html'];
    
    files.forEach(file => {
        const sourcePath = path.join(__dirname, file);
        const destPath = path.join(__dirname, 'public', file);
        
        if (fs.existsSync(sourcePath)) {
            fs.copyFileSync(sourcePath, destPath);
            console.log(`Copied ${file} to public directory`);
        } else {
            console.warn(`${file} not found in root directory`);
        }
    });
}

// Start the server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    copyHtmlFiles();
    console.log(`Access the website at http://localhost:${PORT}`);
});