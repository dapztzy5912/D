
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const slugify = require('slugify');

const app = express();
const port = process.env.PORT || 3000;

mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://zanssxploit:pISqUYgJJDfnLW9b@cluster0.fgram.mongodb.net/dafa_db?retryWrites=true&w=majority', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log('MongoDB Connected'))
.catch(err => console.error('MongoDB Connection Error:', err));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        cb(null, uuidv4() + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Hanya file gambar yang diizinkan!'), false);
        }
    }
});

const ChapterSchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    order: { type: Number, default: 1 }
}, { timestamps: true });

const StorySchema = new mongoose.Schema({
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    genre: { type: String, required: true },
    authorName: { type: String, required: true },
    authorProfileUrl: { type: String, default: '/uploads/default-profile.jpg' },
    coverImageUrl: { type: String, default: '/uploads/default-cover.jpg' },
    chapters: [ChapterSchema],
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
    tags: [{ type: String, trim: true }],
    status: { type: String, enum: ['Ongoing', 'Completed'], default: 'Ongoing' }
}, { timestamps: true });

StorySchema.pre('validate', function(next) {
    if (this.title && (this.isNew || this.isModified('title'))) {
        this.slug = slugify(this.title, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g });
    }
    next();
});


const CommentSchema = new mongoose.Schema({
    storyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Story', required: true },
    commenterName: { type: String, required: true },
    commenterProfileUrl: { type: String, default: '/uploads/default-comment-profile.jpg' },
    text: { type: String, required: true },
}, { timestamps: true });

const Story = mongoose.model('Story', StorySchema);
const Comment = mongoose.model('Comment', CommentSchema);


app.post('/api/stories', upload.fields([
    { name: 'coverImageFile', maxCount: 1 }, 
    { name: 'authorProfileFile', maxCount: 1 }
]), async (req, res) => {
    try {
        const { title, genre, firstChapterContent, firstChapterTitle, authorName, coverImageUrl, authorProfileUrl, tags, status } = req.body;
        const requiredFieldsFromForm = {
            title: title,
            genre: genre,
            firstChapterContent: firstChapterContent,
            authorName: authorName
        };
        const missingFields = [];
        const fieldNameMap = {
            title: 'Judul Cerita',
            genre: 'Genre',
            firstChapterContent: 'Isi Bab Pertama',
            authorName: 'Nama Penulis'
        };

        for (const fieldKey in requiredFieldsFromForm) {
            if (!requiredFieldsFromForm[fieldKey] || requiredFieldsFromForm[fieldKey].trim() === '') {
                missingFields.push(fieldNameMap[fieldKey]);
            }
        }

        if (missingFields.length > 0) {
            return res.status(400).json({ message: `Kolom berikut harus diisi: ${missingFields.join(', ')}.` });
        }

        let finalCoverImageUrl = coverImageUrl || '/uploads/default-cover.jpg';
        if (req.files && req.files.coverImageFile && req.files.coverImageFile[0]) {
            finalCoverImageUrl = `/uploads/${req.files.coverImageFile[0].filename}`;
        }

        let finalAuthorProfileUrl = authorProfileUrl || '/uploads/default-profile.jpg';
        if (req.files && req.files.authorProfileFile && req.files.authorProfileFile[0]) {
            finalAuthorProfileUrl = `/uploads/${req.files.authorProfileFile[0].filename}`;
        }
        
        const tempSlug = slugify(title, { lower: true, strict: true, remove: /[*+~.()'"!:@]/g });
        const existingStory = await Story.findOne({ slug: tempSlug });
        if (existingStory) {
             return res.status(400).json({ message: 'Judul cerita ini sudah ada atau menghasilkan slug yang sama. Silakan gunakan judul lain yang unik.' });
        }

        const newStory = new Story({
            title,
            genre,
            authorName,
            coverImageUrl: finalCoverImageUrl,
            authorProfileUrl: finalAuthorProfileUrl,
            chapters: [{
                title: (firstChapterTitle && firstChapterTitle.trim() !== '') ? firstChapterTitle.trim() : 'Bab 1',
                content: firstChapterContent, 
                order: 1
            }],
            tags: tags ? tags.split(',').map(tag => tag.trim()).filter(tag => tag !== '') : [],
            status: status || 'Ongoing'
        });
        
        await newStory.save();
        res.status(201).json(newStory);
    } catch (error) {
        console.error("Error creating story:", error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: `Kesalahan validasi: ${messages.join('. ')}` });
        }
        if (error.code === 11000) { 
             return res.status(400).json({ message: 'Judul cerita menghasilkan slug yang sudah ada (error kode 11000). Coba judul yang sedikit berbeda.' });
        }
        res.status(500).json({ message: 'Gagal membuat cerita. Silakan coba lagi.', error: error.message });
    }
});

app.get('/api/stories', async (req, res) => {
    try {
        const stories = await Story.find().sort({ createdAt: -1 }).select('-chapters.content');
        res.json(stories);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil cerita', error: error.message });
    }
});

app.get('/api/stories/:slug', async (req, res) => {
    try {
        const story = await Story.findOneAndUpdate(
            { slug: req.params.slug },
            { $inc: { views: 1 } },
            { new: true }
        );

        if (story) {
            res.json(story);
        } else {
            res.status(404).json({ message: 'Cerita tidak ditemukan.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil cerita', error: error.message });
    }
});

app.post('/api/stories/:slug/like', async (req, res) => {
    try {
        const story = await Story.findOneAndUpdate(
            { slug: req.params.slug },
            { $inc: { likes: 1 } },
            { new: true }
        );
        if (story) {
            res.json({ slug: story.slug, likes: story.likes, id: story._id });
        } else {
            res.status(404).json({ message: 'Cerita tidak ditemukan.' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Gagal menyukai cerita', error: error.message });
    }
});

app.post('/api/stories/:slug/chapters', async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!title || !title.trim() || !content || !content.trim()) {
            return res.status(400).json({ message: "Judul bab dan isi bab harus diisi dan tidak boleh kosong." });
        }

        const story = await Story.findOne({ slug: req.params.slug });
        if (!story) {
            return res.status(404).json({ message: "Cerita tidak ditemukan." });
        }

        const newChapter = {
            title: title.trim(),
            content: content.trim(),
            order: story.chapters.length + 1
        };
        story.chapters.push(newChapter);
        await story.save();
        res.status(201).json(story.chapters[story.chapters.length -1]);
    } catch (error) {
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: `Kesalahan validasi bab: ${messages.join('. ')}` });
        }
        res.status(500).json({ message: 'Gagal menambah bab', error: error.message });
    }
});


app.post('/api/comments', upload.single('commenterProfileFile'), async (req, res) => {
    try {
        const { storySlug, commenterName, text } = req.body;
        if (!storySlug || !commenterName || !commenterName.trim() || !text || !text.trim()) {
            return res.status(400).json({ message: 'Slug Cerita, nama, dan teks komentar harus diisi dan tidak boleh kosong.' });
        }

        const story = await Story.findOne({ slug: storySlug });
        if (!story) {
            return res.status(404).json({ message: 'Cerita tidak ditemukan untuk dikomentari.' });
        }

        let commenterProfileUrl = '/uploads/default-comment-profile.jpg';
        if (req.file) {
            commenterProfileUrl = `/uploads/${req.file.filename}`;
        }
        
        const newComment = new Comment({
            storyId: story._id,
            commenterName: commenterName.trim(),
            text: text.trim(),
            commenterProfileUrl,
        });
        await newComment.save();
        res.status(201).json(newComment);
    } catch (error) {
         if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: `Kesalahan validasi komentar: ${messages.join('. ')}` });
        }
        res.status(500).json({ message: 'Gagal mengirim komentar', error: error.message });
    }
});

app.get('/api/comments/:storySlug', async (req, res) => {
    try {
        const story = await Story.findOne({ slug: req.params.storySlug });
        if (!story) {
            return res.status(404).json({ message: 'Cerita tidak ditemukan.' });
        }
        const comments = await Comment.find({ storyId: story._id }).sort({ createdAt: -1 });
        res.json(comments);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil komentar', error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
});
