document.addEventListener('DOMContentLoaded', () => {
    // Elements
    const heroSection = document.getElementById('hero');
    const mediaWrapper = document.getElementById('media-wrapper');
    const blurBg = document.getElementById('blur-bg');
    
    const titleEl = document.getElementById('hero-title');
    const dateEl = document.getElementById('hero-date');
    const explEl = document.getElementById('hero-explanation');
    const copyEl = document.getElementById('hero-copyright');
    const hdLink = document.getElementById('hd-link');
    
    const galleryGrid = document.getElementById('gallery-grid');
    const datePicker = document.getElementById('date-picker');
    const loader = document.getElementById('loader');
    const errorMsg = document.getElementById('error-msg');

    init();

    async function init() {
        const today = new Date().toISOString().split('T')[0];
        datePicker.max = today;
        datePicker.value = today;

        try {
            showLoader(true);
            const todayData = await fetchAPI('/api/apod/today');
            renderHero(todayData);

            const recentData = await fetchAPI('/api/apod/recent?count=12');
            renderGallery(recentData);
        } catch (err) {
            showError(err.message);
        } finally {
            showLoader(false);
        }
    }

    // Date Picker
    datePicker.addEventListener('change', async (e) => {
        if (!e.target.value) return;
        try {
            showLoader(true);
            const data = await fetchAPI(`/api/apod?date=${e.target.value}`);
            renderHero(data);
        } catch (err) {
            showError(err.message);
        } finally {
            showLoader(false);
        }
    });

    async function fetchAPI(url) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        return res.json();
    }

    function getBestImage(data) {
        // Prefer HD image; fallback to URL if it's an image
        if (data.hdurl) return data.hdurl;
        if (data.url && /\.(jpe?g|png|gif)$/i.test(data.url)) return data.url;
        return null; // no usable image
    }

    function renderHero(data) {
        errorMsg.classList.add('hidden');
        heroSection.classList.remove('hidden');

        // Text
        titleEl.textContent = data.title;
        dateEl.textContent = data.date;
        explEl.textContent = data.explanation;
        copyEl.textContent = data.copyright ? `© ${data.copyright}` : '';
        
        // Clear previous media
        mediaWrapper.innerHTML = '';
        
        if (data.media_type === 'video') {
            // Video handling
            blurBg.style.backgroundImage = 'none';
            blurBg.style.backgroundColor = '#000';

            const iframe = document.createElement('iframe');
            iframe.src = data.url;
            iframe.allowFullscreen = true;
            iframe.frameBorder = 0;
            mediaWrapper.appendChild(iframe);
            hdLink.classList.add('hidden');
        } else {
            // Image handling
            const imgUrl = getBestImage(data);
            if (!imgUrl) {
                blurBg.style.backgroundImage = 'none';
                blurBg.style.backgroundColor = '#000';
                mediaWrapper.textContent = 'Image unavailable';
                hdLink.classList.add('hidden');
                return;
            }

            // Blurred background
            blurBg.style.backgroundImage = `url('${imgUrl}')`;
            blurBg.style.backgroundColor = 'transparent';

            // Main Image
            const img = document.createElement('img');
            img.src = imgUrl;
            img.alt = data.title;
            img.onerror = () => {
                img.src = 'https://placehold.co/800x600?text=NO+IMAGE';
                blurBg.style.backgroundImage = 'none';
                blurBg.style.backgroundColor = '#000';
            };
            mediaWrapper.appendChild(img);

            if (data.hdurl) {
                hdLink.href = data.hdurl;
                hdLink.classList.remove('hidden');
            } else {
                hdLink.classList.add('hidden');
            }
        }
    }

    function renderGallery(list) {
        galleryGrid.innerHTML = '';
        list.forEach(item => {
            const card = document.createElement('div');
            card.className = 'gallery-item';
            
            let thumb = getBestImage(item);
            if (!thumb && item.media_type === 'video') {
                thumb = 'https://placehold.co/400x300?text=VIDEO';
            }
            if (!thumb) thumb = 'https://placehold.co/400x300?text=NO+IMAGE';

            const thumbImg = document.createElement('img');
            thumbImg.src = thumb;
            thumbImg.loading = 'lazy';
            thumbImg.className = 'gallery-thumb';
            thumbImg.onerror = () => {
                thumbImg.src = 'https://placehold.co/400x300?text=NO+IMAGE';
            };

            const overlay = document.createElement('div');
            overlay.className = 'gallery-overlay';
            overlay.textContent = item.title;

            card.appendChild(thumbImg);
            card.appendChild(overlay);

            card.addEventListener('click', () => {
                renderHero(item);
                datePicker.value = item.date;
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            galleryGrid.appendChild(card);
        });
    }

    function showLoader(state) {
        loader.classList.toggle('hidden', !state);
    }

    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.classList.remove('hidden');
    }
});
