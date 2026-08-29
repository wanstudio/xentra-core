/*
 * Xentra Checkout JS
 *
 * Full checkout UI/controller for the locked Xentra MVP flow.
 *
 * Locked address flow:
 * - First visit has no address unless a guest address was already saved locally.
 * - Ganti / warning / Isi detail alamat -> address search sheet.
 * - Search uses Xentra REST -> Nominatim backend.
 * - Selecting a result -> address detail sheet.
 * - "Ubah" -> map picker.
 * - Map picker uses OSM tiles through Leaflet and reverse-geocoding through
 *   Xentra REST / Nominatim.
 * - Confirming an address returns to checkout.
 * - Delivery quote uses Xentra REST -> OSRM -> Xentra_Delivery.
 *
 * Locked promo flow:
 * - ON + subtotal >= target -> fixed discount.
 * - Otherwise no discount.
 *
 * Passwordless WhatsApp authentication is handled in-page before order submit.
 */

(function () {

	'use strict';


	/* =========================================================
	 * NAVIGATION STACK (Shared with Home & All Sheets)
	 * ========================================================= */

	if (!window.XentraNav) {
		var navStack = [];
		window.XentraNav = {
			pushClose: function (fn) {
				navStack.push(fn);
			},
			close: function () {
				if (navStack.length) {
					var fn = navStack.pop();
					if (typeof fn === 'function') {
						try { fn(); } catch(e) { console.warn(e); }
					}
					return true;
				}
				return false;
			},
			hasOpen: function () {
				return navStack.length > 0;
			}
		};
	}


	/* =========================================================
	 * CONFIG / SESSION
	 * ========================================================= */

	var SESSION =
		window.XentraCheckoutSession || {};

	var SETTINGS =
		SESSION.settings || {};

	var API =
		(
			window.XentraConfig &&
			window.XentraConfig.restUrl
		) || '/api/v1';


	var TOKEN =
		SESSION.token || '';


	var CLIENT_STORAGE_KEY =
		'xentra_client_id';


	var ADDRESS_STORAGE_KEY =
		'xentra_checkout_address';


	var FAVORITES_STORAGE_KEY =
		'xentra_favorite_addresses';


	var state = window.xentraCheckoutState || {

		fulfillment: {
			type: 'delivery',
			scheduled: false,
			date: '',
			slot: '',
			party_size: ''
		},

		cartSubtotal: 0,

		deliveryDistanceKm: null,

		deliveryDurationMinutes: null,

		deliveryFee: 0,

		deliveryAvailable: true,

		promoDiscount: 0,

		address: null,

		favoriteAddresses: null,

		favoriteAddressesFetched: false,

		payment: {
			method: 'cash',
			/*
			 * Set after a successful /checkout/submit with
			 * payment.method === 'midtrans', so the Snap popup can be
			 * re-opened (retry) without creating a new order if the
			 * customer closes it before finishing.
			 */
			snapToken: null,
			redirectUrl: null
		},

		/* Item currently open in the per-item note sheet. */
		noteItemId: null,

		/* Cached "Tambah ini untuk melengkapi" upsell products. */
		upsellItems: null,

		/* Cached categories for "Ada lagi yang mau dibeli?". */
		browseCategories: null
	};


	window.xentraCheckoutState = state;


	/* =========================================================
	 * HELPERS
	 * ========================================================= */

	function number(value) {

		var n = Number(value);

		return Number.isFinite(n)
			? n
			: 0;
	}


	function money(value) {

		return new Intl.NumberFormat(
			'id-ID',
			{
				style: 'currency',
				currency: 'IDR',
				minimumFractionDigits: 0,
				maximumFractionDigits: 0
			}
		).format(
			Math.max(0, number(value))
		);

	}


	function formatThousand(value) {

		var n = Math.max(0, number(value));

		return new Intl.NumberFormat(
			'id-ID'
		).format(n);
	}


	function shortDiscount(value) {

		var n = number(value);

		if (n >= 1000 && n % 1000 === 0) {
			return (n / 1000) + 'rb';
		}

		return money(n).replace(/\s/g, '');
	}


	function iconForType(type) {

		var pluginUrl =
			(
				window.XentraConfig &&
				window.XentraConfig.pluginUrl
			) || '';

		var icons = {
			delivery: 'delivery.png',
			pickup: 'pick_up.png',
			dinein: 'dine_in.png'
		};

		if (!icons[type]) {
			return '';
		}

		return pluginUrl
			? pluginUrl + '/assets/icons/' + icons[type]
			: '/wp-content/plugins/xentra-mvp/assets/icons/' + icons[type];
	}


	function esc(value) {

		return String(
			value == null ? '' : value
		)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#039;');

	}


	function getClientId() {

		var existing =
			localStorage.getItem(
				CLIENT_STORAGE_KEY
			);

		if (existing) {
			return existing;
		}


		var id =
			(
				'x' +
				Date.now().toString(36) +
				Math.random()
					.toString(36)
					.slice(2, 18)
			).slice(0, 64);


		localStorage.setItem(
			CLIENT_STORAGE_KEY,
			id
		);

		return id;
	}


	var CLIENT_ID = getClientId();


	function getDeviceId() {
		var key = 'xentra_device_id';
		var existing = localStorage.getItem(key);
		if (existing) return existing;

		var bytes = new Uint8Array(24);
		if (window.crypto && window.crypto.getRandomValues) {
			window.crypto.getRandomValues(bytes);
		} else {
			for (var i = 0; i < bytes.length; i++) {
				bytes[i] = Math.floor(Math.random() * 256);
			}
		}

		var id = Array.from(bytes).map(function (n) {
			return n.toString(16).padStart(2, '0');
		}).join('');

		localStorage.setItem(key, id);
		return id;
	}

	var DEVICE_ID = getDeviceId();


	function setCustomerData(name, phone) {
		var nameEl = document.getElementById('x-customer-name');
		var phoneEl = document.getElementById('x-customer-phone');
		if (nameEl) nameEl.value = name || '';
		if (phoneEl) phoneEl.value = phone || '';
		try {
			localStorage.setItem(
				'xentra_customer_data',
				JSON.stringify({ name: name || '', phone: phone || '' })
			);
		} catch (e) {}
	}


	function getCustomerData() {
		var nameEl = document.getElementById('x-customer-name');
		var phoneEl = document.getElementById('x-customer-phone');
		var name = nameEl ? nameEl.value.trim() : '';
		var phone = phoneEl ? phoneEl.value.trim() : '';

		if (!name || !phone) {
			try {
				var saved = JSON.parse(
					localStorage.getItem('xentra_customer_data') || '{}'
				);
				if (!name && saved.name) {
					name = saved.name;
					if (nameEl) nameEl.value = name;
				}
				if (!phone && saved.phone) {
					phone = saved.phone;
					if (phoneEl) phoneEl.value = phone;
				}
			} catch (e) {}
		}

		return {
			name: name,
			phone: phone
		};
	}


	function normalizePhoneForClient(phone) {
		return String(phone || '').replace(/[^0-9]/g, '');
	}


	function maskPhone(phone) {
		var digits = normalizePhoneForClient(phone);
		if (digits.length <= 6) return digits;
		return digits.slice(0, 4) + ' ' + '•'.repeat(Math.max(2, digits.length - 7)) + ' ' + digits.slice(-3);
	}


	function saveGuestAddress(address) {

		try {

			localStorage.setItem(
				ADDRESS_STORAGE_KEY,
				JSON.stringify(address)
			);

		} catch (e) {}
	}


	function loadGuestAddress() {

		try {

			var raw =
				localStorage.getItem(
					ADDRESS_STORAGE_KEY
				);

			return raw
				? JSON.parse(raw)
				: null;

		} catch (e) {

			return null;
		}
	}


	async function api(path, options) {

		options = options || {};

		var headers = Object.assign(
			{
				'Accept': 'application/json',
				'Content-Type': 'application/json'
			},
			options.headers || {}
		);


		if (
			window.XentraConfig &&
			window.XentraConfig.nonce
		) {

			headers['X-WP-Nonce'] =
				window.XentraConfig.nonce;
		}


		var response =
			await fetch(
				API + path,
				Object.assign(
					{
						credentials: 'same-origin',
						headers: headers
					},
					options
				)
			);


		var data;

		try {
			data = await response.json();
		} catch (e) {
			data = {
				success: false,
				message: 'Respons server tidak valid.'
			};
		}


		if (!response.ok) {
			throw new Error(
				data.message ||
				'Permintaan gagal.'
			);
		}


		if (
			data &&
			data.success === false &&
			data.code
		) {
			throw new Error(
				data.message ||
				'Permintaan gagal.'
			);
		}


		return data;
	}


	var activeToastTimer = null;

	function showError(message) {

		var text = String(message || '').trim();
		if (!text) return;

		try {
			console.error('[Xentra Checkout Error]:', text);
		} catch (e) {}

		var existingToast =
			document.getElementById('x-toast-notification');

		if (existingToast) {
			existingToast.remove();
		}

		if (activeToastTimer) {
			clearTimeout(activeToastTimer);
			activeToastTimer = null;
		}

		var toast =
			document.createElement('div');

		toast.id =
			'x-toast-notification';

		toast.className =
			'x-toast-notification';

		toast.innerHTML =
			'<div class="x-toast-inner" style="cursor:pointer;" title="Klik untuk menutup">' +
				'<span>' + esc(text) + '</span>' +
			'</div>';

		toast.addEventListener('click', function () {
			if (activeToastTimer) {
				clearTimeout(activeToastTimer);
				activeToastTimer = null;
			}
			toast.remove();
		});

		document.body.appendChild(toast);

		/* Force reflow to trigger enter animation */
		void toast.offsetWidth;

		toast.classList.add('show');

		activeToastTimer = setTimeout(function () {
			toast.classList.remove('show');
			toast.classList.add('hide');

			setTimeout(function () {
				if (toast && toast.parentNode) {
					toast.parentNode.removeChild(toast);
				}
			}, 300);
		}, 5000);
	}


	/* =========================================================
	 * CART / PAYMENT SUMMARY
	 * ========================================================= */

	function getSessionItems() {

		return Array.isArray(
			SESSION.items
		)
			? SESSION.items
			: [];

	}


	function cartSubtotal() {

		var total = 0;

		getSessionItems().forEach(
			function (item) {

				var qty =
					number(
						item.qty != null
							? item.qty
							: item.quantity
					);

				var price =
					number(item.price);

				total +=
					price * qty;
			}
		);


		return total;
	}


	function promoDiscount() {

		var promo =
			SETTINGS.promo || {};


		if (!promo.enabled) {
			return 0;
		}


		var target =
			Math.max(
				0,
				number(promo.target)
			);

		var discount =
			Math.max(
				0,
				number(promo.discount)
			);


		if (
			target <= 0 ||
			discount <= 0
		) {
			return 0;
		}


		return state.cartSubtotal >= target
			? Math.min(
				discount,
				state.cartSubtotal
			)
			: 0;
	}


	function updateSummary() {

		state.cartSubtotal =
			cartSubtotal();

		state.promoDiscount =
			promoDiscount();


		var subtotalEl =
			document.getElementById(
				'x-sum-subtotal'
			);

		var deliveryEl =
			document.getElementById(
				'x-sum-delivery'
			);

		var discountEl =
			document.getElementById(
				'x-sum-discount'
			);

		var discountRow =
			document.getElementById(
				'x-sum-discount-row'
			);

		var totalEl =
			document.getElementById(
				'x-sum-total'
			);


		if (subtotalEl) {
			subtotalEl.textContent =
				formatThousand(state.cartSubtotal);
		}


		if (deliveryEl) {

			if (
				state.fulfillment.type !==
				'delivery'
			) {

				deliveryEl.textContent =
					'-';

			} else if (
				state.deliveryAvailable &&
				state.address
			) {

				deliveryEl.textContent =
					formatThousand(state.deliveryFee);

			} else {

				deliveryEl.textContent =
					'-';
			}
		}


		if (discountRow) {

			if (
				state.promoDiscount > 0
			) {

				discountRow.style.display =
					'';

			} else {

				discountRow.style.display =
					'none';
			}
		}


		if (discountEl) {

			discountEl.textContent =
				state.promoDiscount > 0
					? '-' +
						formatThousand(
							state.promoDiscount
						)
					: '-';
		}


		var undiscountedTotal =
			state.cartSubtotal +
			(
				state.fulfillment.type ===
				'delivery' &&
				state.deliveryAvailable &&
				state.address
					? number(state.deliveryFee)
					: 0
			);

		var total =
			Math.max(0, undiscountedTotal - state.promoDiscount);


		if (totalEl) {
			if (state.promoDiscount > 0) {
				totalEl.innerHTML =
					'<span style="color:#999;font-size:13px;text-decoration:line-through;margin-right:8px;font-weight:400;">' +
						esc(formatThousand(undiscountedTotal)) +
					'</span>' +
					'<strong style="color:#111;font-size:15px;font-weight:700;">' +
						esc(formatThousand(total)) +
					'</strong>';
			} else {
				totalEl.innerHTML =
					'<strong style="color:#111;font-size:15px;font-weight:700;">' +
						esc(formatThousand(total)) +
					'</strong>';
			}
		}

		renderPaymentLabel();

	}


	function computeItemDiscountEligible(item) {

		var promo =
			SETTINGS.promo || {};

		if (
			!promo.enabled ||
			!(number(promo.target) > 0) ||
			!(number(promo.discount) > 0)
		) {
			return false;
		}

		var qty =
			number(
				item.qty != null
					? item.qty
					: item.quantity
			);

		var price =
			number(item.price);

		return (price * qty) >= number(promo.target);
	}


	/*
	 * Mirror the current session items into the same localStorage cart
	 * (and per-item notes store) that home.js reads/writes, so browsing
	 * back to the menu and returning to checkout never loses or
	 * duplicates anything.
	 */
	function mirrorCartToLocalStorage() {

		try {

			var items =
				getSessionItems().map(
					function (item) {

						return {
							id: number(item.id),
							name: item.name || '',
							quantity: number(
								item.qty != null
									? item.qty
									: item.quantity
							),
							price: number(item.price),
							regular_price: number(
								item.regular_price != null
									? item.regular_price
									: item.price
							),
							sale_price: number(item.price),
							image: item.image || '',
							description: '',
							note: item.note || ''
						};
					}
				);

			localStorage.setItem(
				'xentra_mvp_v4_cart',
				JSON.stringify({
					savedAt: Date.now(),
					expires: Date.now() + (30 * 24 * 60 * 60 * 1000),
					data: { items: items }
				})
			);

			var notes = {};

			items.forEach(function (item) {
				if (item.note) {
					notes[item.id] = item.note;
				}
			});

			localStorage.setItem(
				'xentra_mvp_v4_notes',
				JSON.stringify({
					savedAt: Date.now(),
					expires: Date.now() + (30 * 24 * 60 * 60 * 1000),
					data: notes
				})
			);

		} catch (e) {
			/* localStorage unavailable — non-fatal. */
		}
	}


	function findSessionItem(id) {

		return getSessionItems().find(
			function (item) {
				return number(item.id) === number(id);
			}
		);
	}


	/*
	 * Persist an item's qty/note to the server session, then update the
	 * in-memory SESSION.items array (which every render/summary function
	 * already reads live) and re-render everything that depends on it.
	 */
	async function persistItemChange(id, qty, note) {

		var payload = {
			token: TOKEN,
			id: number(id),
			qty: number(qty)
		};

		if (note !== undefined) {
			payload.note = note;
		}

		var result =
			await api(
				'/checkout/session/item',
				{
					method: 'POST',
					body: JSON.stringify(payload)
				}
			);

		if (result && result.success && Array.isArray(result.items)) {
			SESSION.items = result.items;
		}

		mirrorCartToLocalStorage();

		renderItems();
		updateSummary();

		return result;
	}


	function changeItemQty(id, delta) {

		var item = findSessionItem(id);

		var currentQty =
			item
				? number(
					item.qty != null
						? item.qty
						: item.quantity
				)
				: 0;

		var nextQty =
			Math.max(0, currentQty + delta);

		persistItemChange(id, nextQty).catch(
			function (err) {
				console.warn('[XENTRA ITEM QTY]', err);
			}
		);
	}


	/* =========================================================
	 * PER-ITEM NOTE SHEET
	 * ========================================================= */

	function loadLocalNotes() {
		try {
			var raw = localStorage.getItem('xentra_mvp_v4_notes');
			if (raw) {
				var parsed = JSON.parse(raw);
				var data = parsed.data || parsed;
				if (data && typeof data === 'object') {
					state.notes = data;
				}
			}
		} catch (_) {}
		state.notes = state.notes || {};
	}

	function saveNotes() {
		try {
			localStorage.setItem(
				'xentra_mvp_v4_notes',
				JSON.stringify({
					savedAt: Date.now(),
					expires: Date.now() + (30 * 24 * 60 * 60 * 1000),
					data: state.notes
				})
			);
		} catch (_) {}
	}

	function portalItemNoteSheet() {

		var overlay =
			document.getElementById('x-note-overlay');

		if (overlay && overlay.parentElement !== document.body) {
			document.body.appendChild(overlay);
		}
	}


	function updateItemNoteViewport() {

		var overlay =
			document.getElementById('x-note-overlay');

		var sheet =
			document.getElementById('x-note-sheet');

		if (!overlay || !sheet) return;

		var vv = window.visualViewport;

		if (!vv) {
			sheet.style.setProperty('--x-note-keyboard', '0px');
			sheet.style.setProperty('--x-note-visible-height', '75vh');
			return;
		}

		var keyboardHeight =
			Math.max(0, window.innerHeight - (vv.offsetTop + vv.height));

		sheet.style.setProperty('--x-note-keyboard', keyboardHeight + 'px');
		sheet.style.setProperty('--x-note-visible-height', vv.height + 'px');
	}


	window.xentraOnNoteSaved = function (id, noteText) {
		var numId = number(id);
		state.notes = state.notes || {};
		if (noteText) {
			state.notes[numId] = noteText;
		} else {
			delete state.notes[numId];
		}
		saveNotes();

		var item = findSessionItem(numId);
		if (item) {
			item.note = noteText;
		}
		var qty = item ? number(item.qty != null ? item.qty : item.quantity) : 1;

		mirrorCartToLocalStorage();
		renderItems();

		persistItemChange(numId, qty, noteText).catch(function (err) {
			console.warn('[XENTRA ITEM NOTE]', err);
		});
	};

	function openItemNote(id) {

		var numId = number(id);
		state.noteItemId = numId;
		window.xentraActiveNoteProductId = numId;

		if (typeof window.openHomeNote === 'function') {
			window.openHomeNote(numId);
			return;
		}

		portalItemNoteSheet();

		var overlay =
			document.getElementById('x-note-overlay');

		var input =
			document.getElementById('x-note-input');

		if (!overlay || !input) return;

		var item = findSessionItem(numId);
		var currentNote =
			(state.notes && state.notes[numId]) ||
			(item && item.note) ||
			'';

		input.value = currentNote;

		var sheet =
			document.getElementById('x-note-sheet');

		if (sheet) {
			sheet.style.setProperty('--x-note-keyboard', '0px');
			sheet.style.setProperty('--x-note-visible-height', '75dvh');
		}

		updateItemNoteCounter();

		var saveBtn =
			document.getElementById('x-note-save');

		if (saveBtn) {
			saveBtn.onclick = function (e) {
				if (e) {
					e.preventDefault();
					e.stopPropagation();
				}
				saveItemNote();
			};
		}

		window.XentraNav.pushClose(closeItemNote);

		void (sheet || overlay).offsetHeight;

		window.requestAnimationFrame(function () {
			overlay.classList.add('open');
		});

		setTimeout(function () {
			input.focus();
			updateItemNoteViewport();
		}, 350);
	}


	function closeItemNote() {

		var overlay =
			document.getElementById('x-note-overlay');

		var input =
			document.getElementById('x-note-input');

		if (!overlay) return;

		if (input) {
			input.blur();
		}

		overlay.classList.remove('open');

		var sheet =
			document.getElementById('x-note-sheet');

		setTimeout(function () {
			if (sheet) {
				sheet.style.setProperty('--x-note-keyboard', '0px');
				sheet.style.setProperty('--x-note-visible-height', '75dvh');
			}
		}, 380);

		state.noteItemId = null;
	}


	function updateItemNoteCounter() {

		var input =
			document.getElementById('x-note-input');

		var counter =
			document.getElementById('x-note-counter');

		if (!input || !counter) return;

		counter.textContent =
			(input.value || '').length + '/200';
	}


	function saveItemNote() {

		var input =
			document.getElementById('x-note-input');

		var currentId =
			state.noteItemId != null
				? number(state.noteItemId)
				: null;

		if (!input || currentId == null) {
			window.XentraNav.close();
			return;
		}

		var noteText = input.value ? input.value.trim() : '';

		state.notes = state.notes || {};

		if (noteText) {
			state.notes[currentId] = noteText;
		} else {
			delete state.notes[currentId];
		}
		saveNotes();

		var item = findSessionItem(currentId);
		if (item) {
			item.note = noteText;
		}

		var qty =
			item
				? number(
					item.qty != null
						? item.qty
						: item.quantity
				)
				: 1;

		mirrorCartToLocalStorage();
		renderItems();

		window.XentraNav.close();

		persistItemChange(currentId, qty, noteText).catch(
			function (err) {
				console.warn('[XENTRA ITEM NOTE]', err);
			}
		);
	}


	function setupItemNoteSheet() {

		if (window.__XENTRA_MENU_V4 || typeof window.openHomeNote === 'function') {
			return;
		}

		var overlay =
			document.getElementById('x-note-overlay');

		var input =
			document.getElementById('x-note-input');

		var saveBtn =
			document.getElementById('x-note-save');

		var sheet =
			document.getElementById('x-note-sheet');

		if (!overlay) return;

		portalItemNoteSheet();

		if (input) {
			input.oninput = updateItemNoteCounter;
		}

		if (saveBtn) {
			saveBtn.onclick = function (e) {
				if (e) {
					e.preventDefault();
					e.stopPropagation();
				}
				saveItemNote();
			};
		}

		overlay.onclick = function (e) {
			if (e.target === overlay) {
				window.XentraNav.close();
			}
		};

		if (window.visualViewport) {
			window.visualViewport.addEventListener('resize', updateItemNoteViewport);
			window.visualViewport.addEventListener('scroll', updateItemNoteViewport);
		}

		window.addEventListener('resize', updateItemNoteViewport);

		if (sheet) {

			var noteStartY = 0;
			var noteCurrentY = 0;

			sheet.addEventListener('touchstart', function (e) {
				noteStartY = e.touches[0].clientY;
				noteCurrentY = noteStartY;
			}, { passive: true });

			sheet.addEventListener('touchmove', function (e) {
				noteCurrentY = e.touches[0].clientY;
			}, { passive: true });

			sheet.addEventListener('touchend', function () {
				if (noteCurrentY - noteStartY > 60) {
					window.XentraNav.close();
				}
			}, { passive: true });
		}
	}


	function bindItemEvents(container) {

		container.querySelectorAll('[data-item-plus]').forEach(
			function (btn) {
				btn.addEventListener('click', function () {
					changeItemQty(btn.getAttribute('data-item-plus'), 1);
				});
			}
		);

		container.querySelectorAll('[data-item-minus]').forEach(
			function (btn) {
				btn.addEventListener('click', function () {
					changeItemQty(btn.getAttribute('data-item-minus'), -1);
				});
			}
		);

		container.querySelectorAll('[data-item-note]').forEach(
			function (btn) {
				btn.addEventListener('click', function () {
					openItemNote(btn.getAttribute('data-item-note'));
				});
			}
		);
	}


	function renderItems() {

		var container =
			document.getElementById(
				'x-items-card'
			);


		if (!container) return;


		var items =
			getSessionItems();


		if (!items.length) {

			container.innerHTML =
				'<p>Keranjang kosong.</p>';

			return;
		}


		var icons =
			SETTINGS.icons || {};

		var promo =
			SETTINGS.promo || {};


		var html =
			'<div class="x-checkout-items">';


		items.forEach(
			function (item) {

				var id =
					number(item.id);

				var qty =
					number(
						item.qty != null
							? item.qty
							: item.quantity
					);

				var price =
					number(item.price);

				var regularPrice =
					number(
						item.regular_price != null
							? item.regular_price
							: price
					);

				var hasOldPrice =
					regularPrice > price;

				var note =
					(state.notes && state.notes[id]) ||
					item.note ||
					'';

				var noteIcon =
					note
						? (icons.write || icons.file || '')
						: (icons.file || icons.write || '');

				var discountEligible =
					computeItemDiscountEligible(item);


				html +=
					'<div class="x-product x-checkout-item" data-item-id="' +
						id +
					'">' +

						'<div class="x-product-info">' +

							'<div class="x-product-name">' +
								esc(item.name || '') +
							'</div>' +

							(
								note
									? '<div class="x-product-note-inline">Catatan : ' +
										esc(note) +
										'</div>'
									: ''
							) +

							'<div class="x-price">' +
								(
									hasOldPrice
										? '<div class="x-old-price">' +
											esc(money(regularPrice)) +
											'</div>'
										: ''
								) +
								'<div class="x-current-price">' +
									esc(money(price)) +
								'</div>' +
							'</div>' +

							(
								discountEligible
									? '<div class="x-product-discount">' +
										(
											icons.diskon
												? '<img src="' +
													esc(icons.diskon) +
													'" alt="Diskon" class="x-product-discount-icon">'
												: ''
										) +
										'<span>Discount ongkir ' +
											esc(shortDiscount(promo.discount)) +
										'</span>' +
									'</div>'
									: ''
							) +

						'</div>' +

						'<div class="x-product-right">' +

							(
								item.image
									? '<img class="x-product-image" src="' +
										esc(item.image) +
										'" alt="' +
										esc(item.name || '') +
										'" loading="lazy">'
									: ''
							) +

							'<div class="x-quantity">' +
								'<button type="button" data-item-minus="' +
									id +
								'">' +
									(
										icons.minus
											? '<img src="' + esc(icons.minus) + '" alt="minus">'
											: '−'
									) +
								'</button>' +
								'<span class="x-quantity-value">' +
									qty +
								'</span>' +
								'<button type="button" data-item-plus="' +
									id +
								'">' +
									(
										icons.plus
											? '<img src="' + esc(icons.plus) + '" alt="plus">'
											: '＋'
									) +
								'</button>' +
							'</div>' +

							'<button type="button" class="x-note-button' +
								(note ? ' has-note' : '') +
								'" data-item-note="' +
								id +
							'">' +
								(
									noteIcon
										? '<img src="' + esc(noteIcon) + '" alt="Catatan" class="x-note-icon">'
										: ''
								) +
								'<span>Catatan</span>' +
							'</button>' +

						'</div>' +

					'</div>';
			}
		);


		html += '</div>';

		html += renderComplementSectionHtml();

		container.innerHTML = html;
		bindItemEvents(container);

		loadUpsellItems();
	}


	/* =========================================================
	 * "TAMBAH INI UNTUK MELENGKAPI MAKANANMU"
	 * ========================================================= */

	function renderComplementSectionHtml() {

		return (
			'<div class="x-complement-section">' +
				'<div class="x-section-title">Tambah ini untuk melengkapi makananmu</div>' +
				'<div class="x-complement-track" id="x-complement-track">' +
					'<div class="x-loading-inline">Memuat rekomendasi...</div>' +
				'</div>' +
			'</div>'
		);
	}


	async function loadUpsellItems() {

		var track =
			document.getElementById('x-complement-track');

		if (!track) return;

		try {

			var result =
				await api(
					'/checkout/upsell?token=' +
					encodeURIComponent(TOKEN),
					{ method: 'GET' }
				);

			var items =
				(result && Array.isArray(result.items))
					? result.items
					: [];

			state.upsellItems = items;

			if (!items.length) {
				track.innerHTML = '';
				track.parentElement.style.display = 'none';
				return;
			}

			track.parentElement.style.display = '';

			var html = '';

			items.forEach(function (product) {

				var price =
					number(
						product.price != null
							? product.price
							: (product.prices && product.prices.price)
					);

				html +=
					'<div class="x-complement-card">' +
						'<div class="x-complement-left">' +
							(
								product.image
									? '<img src="' + esc(product.image) + '" alt="' + esc(product.name || '') + '" loading="lazy">'
									: ''
							) +
						'</div>' +
						'<div class="x-complement-right">' +
							'<div class="x-complement-name">' + esc(product.name || '') + '</div>' +
							'<div class="x-complement-price">' + esc(money(price)) + '</div>' +
							'<button type="button" class="x-add x-upsell-add-btn" data-upsell-add="' + number(product.id) + '">Tambah</button>' +
						'</div>' +
					'</div>';
			});

			track.innerHTML = html;

			track.querySelectorAll('[data-upsell-add]').forEach(function (btn) {
				btn.addEventListener('click', function () {
					addUpsellItem(btn.getAttribute('data-upsell-add'));
				});
			});

		} catch (e) {
			console.warn('[XENTRA UPSELL]', e);
			track.innerHTML = '';
			track.parentElement.style.display = 'none';
		}
	}


	async function addUpsellItem(id) {

		var product =
			(state.upsellItems || []).find(
				function (p) {
					return number(p.id) === number(id);
				}
			);

		if (!product) return;

		var existing = findSessionItem(id);

		var currentQty =
			existing
				? number(
					existing.qty != null
						? existing.qty
						: existing.quantity
				)
				: 0;

		try {

			await persistItemChange(id, currentQty + 1);

			var itemsCard =
				document.getElementById('x-items-card');

			if (itemsCard) {
				itemsCard.scrollIntoView({
					behavior: 'smooth',
					block: 'start'
				});
			}

		} catch (e) {
			console.warn('[XENTRA UPSELL ADD]', e);
		}
	}


	/* =========================================================
	 * "ADA LAGI YANG MAU DIBELI?"
	 * ========================================================= */

	var CHECKOUT_DRAFT_KEY = 'xentra_checkout_draft';


	function renderBrowseSectionHtml() {

		return (
			'<div class="x-browse-section" style="display:none;">' +
				'<div class="x-section-title">Ada lagi yang mau dibeli?</div>' +
				'<div class="x-section-subtitle">Masih bisa nambah menu lain, ya.</div>' +
				'<div class="x-cat-track" id="x-browse-cat-track"></div>' +
			'</div>'
		);
	}


	async function loadBrowseCategories() {

		var track =
			document.getElementById('x-browse-cat-track');

		if (!track) return;

		// 1. In-memory Home state categories:
		if (window.__xentraHomeState && Array.isArray(window.__xentraHomeState.categories) && window.__xentraHomeState.categories.length) {
			state.browseCategories = window.__xentraHomeState.categories;
			renderBrowseCategories(state.browseCategories);
			return;
		}

		if (state.browseCategories && state.browseCategories.length) {
			renderBrowseCategories(state.browseCategories);
			return;
		}

		// 2. Read from Home localStorage cache:
		try {
			var cachedRaw = localStorage.getItem('xentra_mvp_v4_home');
			if (cachedRaw) {
				var cached = JSON.parse(cachedRaw);
				var cats = (cached.data && cached.data.categories) || cached.categories;
				if (Array.isArray(cats) && cats.length) {
					state.browseCategories = cats;
					renderBrowseCategories(cats);
					return;
				}
			}
		} catch (_) {}

		// 3. Fallback to /home API:
		try {
			var res =
				await fetch(
					(window.XentraConfig && window.XentraConfig.restUrl ? window.XentraConfig.restUrl : '/api/v1') +
					'/home?per_page=12&page=1',
					{ credentials: 'same-origin', cache: 'default' }
				);

			if (res.ok) {
				var homeData = await res.json();
				if (homeData && Array.isArray(homeData.categories) && homeData.categories.length) {
					state.browseCategories = homeData.categories;
					renderBrowseCategories(homeData.categories);
					return;
				}
			}
		} catch (e) {
			console.warn('[XENTRA BROWSE CATEGORIES]', e);
			track.innerHTML = '';
		}
	}


	function renderBrowseCategories(categories) {

		var track =
			document.getElementById('x-browse-cat-track');

		if (!track) return;

		if (!categories.length) {
			track.innerHTML = '';
			return;
		}

		var html = '';

		categories.forEach(function (category) {

			html +=
				'<button type="button" class="x-cat" data-browse-slug="' +
					esc(category.slug || '') +
				'" data-browse-id="' +
					category.id +
				'">' +
					'<span class="x-cat-image">' +
						(
							category.image
								? '<img src="' + esc(category.image) + '" alt="' + esc(category.name) + '" loading="lazy">'
								: ''
						) +
					'</span>' +
					'<span class="x-cat-name">' + esc(category.name) + '</span>' +
				'</button>';
		});

		track.innerHTML = html;

		track.onclick = function (e) {
			var btn = e.target.closest('[data-browse-slug]');
			if (!btn) return;
			e.preventDefault();
			e.stopPropagation();
			navigateToCategory(
				btn.getAttribute('data-browse-slug'),
				btn.getAttribute('data-browse-id')
			);
		};
	}


	function saveCheckoutDraft() {

		try {

			var nameEl = document.getElementById('x-customer-name');
			var phoneEl = document.getElementById('x-customer-phone');

			localStorage.setItem(
				CHECKOUT_DRAFT_KEY,
				JSON.stringify({
					name: nameEl ? nameEl.value : '',
					phone: phoneEl ? phoneEl.value : '',
					savedAt: Date.now()
				})
			);

		} catch (e) {
			/* non-fatal */
		}
	}


	function restoreCheckoutDraft() {

		try {

			var raw = localStorage.getItem(CHECKOUT_DRAFT_KEY);

			if (!raw) return;

			var draft = JSON.parse(raw);

			if (!draft) return;

			var nameEl = document.getElementById('x-customer-name');
			var phoneEl = document.getElementById('x-customer-phone');

			if (nameEl && draft.name && !nameEl.value) {
				nameEl.value = draft.name;
			}

			if (phoneEl && draft.phone && !phoneEl.value) {
				phoneEl.value = draft.phone;
			}

		} catch (e) {
			/* non-fatal */
		}
	}


	function navigateToCategory(slug, id) {

		saveCheckoutDraft();

		var targetCat = id || slug;
		window.__xentraPendingCategory = targetCat;

		if (typeof window.XentraSelectCategory === 'function') {
			window.XentraSelectCategory(targetCat);
		}

		if (window.XentraNav && typeof window.XentraNav.hasOpen === 'function' && window.XentraNav.hasOpen()) {
			window.XentraNav.close();
			return;
		}

		var host = document.getElementById('xentra-checkout-state');
		var homeApp = document.getElementById('xentra-menu-app');
		if (host && homeApp) {
			host.style.display = 'none';
			host.innerHTML = '';
			homeApp.style.display = '';
			document.body.style.overflow = '';
			return;
		}

		var homeUrl =
			(window.XentraConfig && window.XentraConfig.homeUrl) || '/';

		var separator =
			homeUrl.indexOf('?') === -1 ? '?' : '&';

		window.location.href =
			homeUrl + separator + 'xentra_cat=' + encodeURIComponent(targetCat);
	}





	/* =========================================================
	 * ADDRESS STATE
	 * ========================================================= */

	function getStoredFavorites() {

		if (
			Array.isArray(
				state.favoriteAddresses
			)
		) {
			return state.favoriteAddresses;
		}

		try {

			var stored =
				localStorage.getItem(
					FAVORITES_STORAGE_KEY
				);

			if (stored) {

				var parsed =
					JSON.parse(
						stored
					);

				if (
					Array.isArray(
						parsed
					)
				) {

					state.favoriteAddresses =
						parsed;

					return parsed;
				}
			}

		} catch (e) {}

		state.favoriteAddresses =
			[];

		return state.favoriteAddresses;
	}


	function restoreAddress() {

		var favorites =
			getStoredFavorites();

		if (!favorites || favorites.length === 0) {
			clearAddress();
			return;
		}

		var saved =
			loadGuestAddress();

		if (!saved || !saved.formatted_address) {
			if (favorites.length > 0) {
				state.address = Object.assign({}, favorites[0]);
				saveGuestAddress(state.address);
				updateAddressBlock();
				updateDeliveryQuote();
			} else {
				clearAddress();
			}
			return;
		}

		var matching = favorites.find(function (fav) {
			return (
				(saved.id && fav.id && String(fav.id) === String(saved.id)) ||
				(fav.formatted_address && fav.formatted_address === saved.formatted_address) ||
				(fav.name && saved.name && fav.name === saved.name)
			);
		});

		if (matching) {
			state.address = Object.assign({}, matching, saved);
			updateAddressBlock();
			updateDeliveryQuote();
		} else if (favorites.length > 0) {
			state.address = Object.assign({}, favorites[0]);
			saveGuestAddress(state.address);
			updateAddressBlock();
			updateDeliveryQuote();
		} else {
			clearAddress();
		}
	}


	function setAddress(address) {

		state.address =
			Object.assign(
				{},
				address
			);

		var addrNote = state.address ? String(state.address.driver_note || state.address.note || '').trim() : '';
		if (addrNote) {
			state.orderNote = addrNote;
			try {
				localStorage.setItem(NOTE_STORAGE_KEY, state.orderNote);
			} catch (e) {}
		} else {
			state.orderNote = '';
			try {
				localStorage.removeItem(NOTE_STORAGE_KEY);
			} catch (e) {}
		}

		saveGuestAddress(
			state.address
		);

		updateAddressBlock();
		updateNoteButton();

		updateDeliveryQuote();

	}


	function clearAddress() {

		state.address = null;
		state.orderNote = '';

		try {
			localStorage.removeItem(
				ADDRESS_STORAGE_KEY
			);
			localStorage.removeItem(
				NOTE_STORAGE_KEY
			);
		} catch (e) {}

		updateAddressBlock();
		updateNoteButton();

		state.deliveryFee = 0;
		state.deliveryAvailable = false;

		updateSummary();

	}


	function updateAddressBlock() {

		var block =
			document.getElementById(
				'x-address-block'
			);

		if (!block) return;

		var address =
			state.address || null;

		var hasAddress =
			Boolean(
				address &&
				address.formatted_address
			);

		var placeTitle = hasAddress
			? (address.name || address.title || address.label || 'Alamat')
			: '';

		var formattedAddr = hasAddress
			? (address.formatted_address || '')
			: '';

		var patokan = hasAddress && address.detail
			? address.detail
			: '';

		var driverNoteText = (state.orderNote || (address && address.driver_note) || '').trim();

		var topHtml =
			'<div class="x-address-top-row" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
				'<div class="x-address-main-info" style="flex:1;min-width:0;max-width:62%;">' +
					'<div class="x-address-heading" style="font-size:15px;line-height:20px;font-weight:700;color:#222;margin-bottom:4px;">' +
						'Alamat Pengantaran' +
					'</div>';

		if (hasAddress) {
			topHtml +=
					'<strong class="x-address-title" style="display:block;font-size:14px;line-height:19px;font-weight:700;color:#222;word-break:break-word;overflow-wrap:anywhere;">' +
						esc(placeTitle) +
					'</strong>' +
					'<div class="x-address-formatted" style="font-size:12px;line-height:17px;color:#666;margin-top:2px;word-break:break-word;overflow-wrap:anywhere;">' +
						esc(formattedAddr) +
					'</div>';
		}

		topHtml +=
				'</div>' +
				'<div class="x-address-top-btn" style="flex:0 0 auto;">' +
					'<button type="button" class="x-address-change-btn x-pill-btn" id="x-address-change">' +
						esc(hasAddress ? 'Pilih alamat' : 'Tambah alamat') +
					'</button>' +
				'</div>' +
			'</div>';

		var extraHtml = '';
		if (!hasAddress) {
			extraHtml =
				'<div class="x-address-warning" id="x-address-warning">' +
					'<strong>!</strong>' +
					'<span>Isi detail alamat agar driver gampang cari lokasimu pas antar makanan.</span>' +
				'</div>';
		} else if (patokan || driverNoteText) {
			extraHtml =
				'<div class="x-address-extra-full" style="width:100%;margin-top:10px;word-break:break-word;overflow-wrap:anywhere;">';

			if (patokan) {
				extraHtml +=
					'<div class="x-address-patokan" style="padding-left:8px;border-left:2px solid #ccc;font-style:italic;font-size:12px;line-height:17px;color:#777;margin-bottom:6px;word-break:break-word;overflow-wrap:anywhere;">' +
						esc(patokan) +
					'</div>';
			}

			if (driverNoteText) {
				extraHtml +=
					'<div class="x-address-note" style="font-size:12px;line-height:17px;color:#555;word-break:break-word;overflow-wrap:anywhere;">' +
						'<strong style="font-weight:700;color:#222;">Catatan driver:</strong> ' +
						'<span style="font-weight:400;color:#666;word-break:break-word;overflow-wrap:anywhere;">' + esc(driverNoteText) + '</span>' +
					'</div>';
			}

			extraHtml +=
				'</div>';
		}

		block.innerHTML = topHtml + extraHtml;


		var change =
			document.getElementById(
				'x-address-change'
			);

		var detail =
			document.getElementById(
				'x-address-detail-trigger'
			);

		var warning =
			document.getElementById(
				'x-address-warning'
			);

		var note =
			document.getElementById(
				'x-order-note-button'
			);


		if (change) {

			change.addEventListener(
				'click',
				openAddressPicker
			);
		}


		if (detail) {

			/*
			 * LOCKED:
			 * Isi detail alamat opens Detail Alamat sheet
			 * directly, without leaving checkout.
			 */
			detail.addEventListener(
				'click',
				function () {
					openAddressDetailSheet(
					state.address || {}
				);
				}
			);
		}


		if (warning) {

			warning.addEventListener(
				'click',
				openAddressPicker
			);
		}


		if (note) {

			note.addEventListener(
				'click',
				openOrderNote
			);
		}
	}


	function setAddressIcons() {

		var icons =
			(
				window.XentraCheckoutSession &&
				window.XentraCheckoutSession.settings &&
				window.XentraCheckoutSession.settings.icons
			) || {};


		/*
		 * Dedicated developer assets.
		 * pinlok is not part of the old icon registry.
		 */
		var pluginBase =
			(
				window.XentraConfig &&
				window.XentraConfig.pluginUrl
			) || '';


		var pinUrl =
			icons.pinlok ||
			(
				pluginBase
					? pluginBase + 'assets/icons/pinlok.svg'
					: ''
			);


		var fileUrl =
			icons.file || '';


		var writeUrl =
			icons.write || '';


		var pinEl =
			document.getElementById(
				'x-address-detail-icon'
			);


		var noteEl =
			document.getElementById(
				'x-order-note-icon'
			);


		if (pinEl) {

			pinEl.innerHTML =
				pinUrl
					? '<img src="' +
						esc(pinUrl) +
						'" alt="" aria-hidden="true">'
					: '';
		}


		if (noteEl) {

			var noteUrl =
				state.orderNote
					? writeUrl
					: fileUrl;


			noteEl.innerHTML =
				noteUrl
					? '<img src="' +
						esc(noteUrl) +
						'" alt="" aria-hidden="true">'
					: '';
		}
	}



	var NOTE_STORAGE_KEY =
		'xentra_checkout_order_note';


	function loadOrderNote() {

		if (state.orderNote != null) {
			return state.orderNote;
		}

		try {
			state.orderNote =
				localStorage.getItem(
					NOTE_STORAGE_KEY
				) || '';
		} catch (e) {
			state.orderNote = '';
		}

		return state.orderNote;
	}


	function saveOrderNote(note) {

		state.orderNote =
			String(note || '').trim();

		try {

			if (state.orderNote) {

				localStorage.setItem(
					NOTE_STORAGE_KEY,
					state.orderNote
				);

			} else {

				localStorage.removeItem(
					NOTE_STORAGE_KEY
				);
			}

		} catch (e) {}

		if (state.address) {
			state.address.driver_note = state.orderNote;
			state.address.note = state.orderNote;
		}

		updateAddressBlock();
		updateNoteButton();

		var driverNoteIcon = document.getElementById('x-address-driver-note-icon');
		if (driverNoteIcon) {
			var iconBase = (window.XentraConfig && window.XentraConfig.pluginUrl) || '/wp-content/plugins/xentra-mvp';
			var iconSrc = state.orderNote
				? (iconBase + '/assets/icons/write.svg')
				: (iconBase + '/assets/icons/file.svg');
			driverNoteIcon.innerHTML = '<img src="' + esc(iconSrc) + '" alt="" style="width:15px;height:15px;object-fit:contain;display:block;">';
		}
	}


	function ensureNoteSheet() {

		var overlay =
			document.getElementById(
				'x-checkout-note-overlay'
			);

		if (overlay) {
			return overlay;
		}

		overlay =
			document.createElement('div');

		overlay.id =
			'x-checkout-note-overlay';

		overlay.className =
			'x-checkout-note-overlay';

		overlay.innerHTML =
			'<div id="x-checkout-note-sheet" class="x-note-sheet">' +
				'<div class="x-note-handle"></div>' +

				'<div class="x-note-header">' +
					'<h3>Catatan untuk driver</h3>' +
				'</div>' +

				'<textarea id="x-checkout-note-input" maxlength="200" ' +
					'placeholder="Catatan untuk driver">' +
				'</textarea>' +

				'<div class="x-note-footer">' +
					'<span id="x-checkout-note-counter">0/200</span>' +
					'<button id="x-checkout-note-save" type="button">Simpan</button>' +
				'</div>' +
			'</div>';

		document.body.appendChild(overlay);

		return overlay;
	}


	function portalNoteSheet() {

		var overlay =
			document.getElementById(
				'x-checkout-note-overlay'
			);

		if (
			overlay &&
			overlay.parentElement !==
			document.body
		) {
			document.body.appendChild(overlay);
		}
	}


	function updateNoteViewport() {

		var overlay =
			document.getElementById(
				'x-checkout-note-overlay'
			);

		var sheet =
			document.getElementById(
				'x-checkout-note-sheet'
			);

		if (!overlay || !sheet) {
			return;
		}

		var viewport =
			window.visualViewport;

		if (!viewport) {

			sheet.style.setProperty(
				'--x-note-keyboard',
				'0px'
			);

			sheet.style.setProperty(
				'--x-note-visible-height',
				'75vh'
			);

			return;
		}

		var keyboardHeight =
			Math.max(
				0,
				window.innerHeight -
				(
					viewport.offsetTop +
					viewport.height
				)
			);

		sheet.style.setProperty(
			'--x-note-keyboard',
			keyboardHeight + 'px'
		);

		sheet.style.setProperty(
			'--x-note-visible-height',
			viewport.height + 'px'
		);
	}


	function updateNoteCounter() {

		var input =
			document.getElementById(
				'x-checkout-note-input'
			);

		var counter =
			document.getElementById(
				'x-checkout-note-counter'
			);

		if (!input || !counter) {
			return;
		}

		counter.textContent =
			input.value.length + '/200';
	}


	function updateNoteButton() {

		var button =
			document.getElementById(
				'x-order-note-button'
			);

		var icon =
			document.getElementById(
				'x-order-note-icon'
			);

		if (!button) {
			return;
		}

		var hasNote =
			Boolean(loadOrderNote());

		button.classList.toggle(
			'has-note',
			hasNote
		);

		var icons =
			SETTINGS.icons || {};

		var pluginBase =
			(
				window.XentraConfig &&
				window.XentraConfig.pluginUrl
			) || '/wp-content/plugins/xentra-mvp';

		var iconUrl =
			hasNote
				? (icons.write || (pluginBase + '/assets/icons/write.svg'))
				: (icons.file || (pluginBase + '/assets/icons/file.svg'));

		if (icon) {

			icon.innerHTML =
				iconUrl
					? '<img src="' +
						esc(iconUrl) +
						'" alt="" aria-hidden="true">'
					: '';
		}

		button.setAttribute(
			'aria-label',
			hasNote
				? 'Edit catatan'
				: 'Tambah catatan'
		);
	}


	function openOrderNote() {

		var overlay =
			ensureNoteSheet();

		portalNoteSheet();

		var input =
			document.getElementById(
				'x-checkout-note-input'
			);

		if (!input) {
			return;
		}

		input.value =
			loadOrderNote();

		updateNoteCounter();
		updateNoteViewport();

		var sheet =
			document.getElementById(
				'x-checkout-note-sheet'
			);

		if (sheet) {
			sheet.style.setProperty('--x-note-keyboard', '0px');
			sheet.style.setProperty('--x-note-visible-height', '75dvh');
		}

		if (
			overlay.dataset.bound !==
			'1'
		) {

			overlay.dataset.bound =
				'1';

			var save =
				document.getElementById(
					'x-checkout-note-save'
				);

			if (save) {

				save.addEventListener(
					'click',
					function () {

						saveOrderNote(
							input.value
						);

						if (window.XentraNav && typeof window.XentraNav.close === 'function') {
							window.XentraNav.close();
						} else {
							closeOrderNote();
						}
					}
				);
			}

			overlay.addEventListener(
				'click',
				function (event) {

					if (
						event.target ===
						overlay
					) {
						window.XentraNav.close();
					}
				}
			);

			var noteStartY = 0;
			var noteCurrentY = 0;

			if (sheet) {

				sheet.addEventListener(
					'touchstart',
					function (event) {

						noteStartY =
							event.touches[0].clientY;

						noteCurrentY =
							noteStartY;
					},
					{ passive: true }
				);

				sheet.addEventListener(
					'touchmove',
					function (event) {

						noteCurrentY =
							event.touches[0].clientY;
					},
					{ passive: true }
				);

				sheet.addEventListener(
					'touchend',
					function () {

						if (
							noteCurrentY -
							noteStartY >
							60
						) {
							window.XentraNav.close();
						}
					},
					{ passive: true }
				);
			}
		}

		window.XentraNav.pushClose(closeOrderNote);

		void (sheet || overlay).offsetHeight;

		requestAnimationFrame(
			function () {

				overlay.classList.add(
					'open'
				);
			}
		);

		setTimeout(
			function () {

				input.focus();
				updateNoteViewport();

			},
			350
		);
	}


	function closeOrderNote() {

		var overlay =
			document.getElementById(
				'x-checkout-note-overlay'
			);

		if (!overlay) {
			return;
		}

		var input =
			document.getElementById(
				'x-checkout-note-input'
			);

		if (input) {
			input.blur();
		}

		overlay.classList.remove(
			'open'
		);

		var sheet =
			document.getElementById(
				'x-checkout-note-sheet'
			);

		setTimeout(function () {
			if (sheet) {
				sheet.style.setProperty('--x-note-keyboard', '0px');
				sheet.style.setProperty('--x-note-visible-height', '75dvh');
			}
		}, 380);
	}


	if (window.visualViewport) {

		window.visualViewport.addEventListener(
			'resize',
			updateNoteViewport
		);

		window.visualViewport.addEventListener(
			'scroll',
			updateNoteViewport
		);
	}

	window.addEventListener(
		'resize',
		updateNoteViewport
	);


	function setupOrderNoteSheet() {

		updateNoteButton();
	}


	/* =========================================================
	 * ADDRESS SEARCH SHEET
	 * ========================================================= */

	function closeTopOverlay() {

		var overlays =
			document.querySelectorAll(
				'.xentra-dynamic-overlay.open'
			);

		if (!overlays.length) {
			overlays =
				document.querySelectorAll(
					'.xentra-dynamic-overlay'
				);
		}

		if (!overlays.length) {
			return false;
		}

		var overlay =
			overlays[overlays.length - 1];

		closeDynamicOverlay(overlay);

		return true;
	}


	function createOverlay(className) {

		var overlay =
			document.createElement('div');

		overlay.className =
			'x-overlay xentra-dynamic-overlay ' +
			(className || '');

		overlay.style.zIndex = '1000000';

		return overlay;
	}


	function openDynamicOverlay(overlay) {

		document.body.appendChild(overlay);

		overlay.__xentraClose = function () {
			closeDynamicOverlay(overlay);
		};

		// Force layout before adding the class so the transition runs smoothly
		void overlay.offsetHeight;

		window.requestAnimationFrame(function () {
			overlay.classList.add('open');
		});
	}

	function closeDynamicOverlay(overlay) {

		if (!overlay || overlay.__xentraClosing) {
			return;
		}

		overlay.__xentraClosing = true;
		overlay.style.pointerEvents = 'none';
		overlay.classList.remove('open');

		window.setTimeout(
			function () {
				if (overlay.parentNode) {
					overlay.remove();
				}
			},
			400
		);
	}

	/*
	 * Bind tap-outside-to-close and swipe-down-to-close on a freshly
	 * created overlay. Identical to Cart in home.js.
	 */
	function bindDynamicOverlayDismiss(overlay, sheetSelector) {

		overlay.addEventListener('click', function (event) {
			if (event.target === overlay) {
				closeDynamicOverlay(overlay);
			}
		});

		var sheet = overlay.querySelector(sheetSelector || '.x-sheet-inner');

		if (!sheet) {
			return;
		}

		var sheetTouchStartY = 0;
		var sheetTouchEndY = 0;
		var isMultiTouch = false;
		var touchStartedOnInteractive = false;

		sheet.addEventListener(
			'touchstart',
			function (e) {
				if (e.touches.length > 1) {
					isMultiTouch = true;
					return;
				}
				isMultiTouch = false;

				// Ignore touches originating on map canvas, controls, buttons, or inputs
				if (
					e.target.closest('.mapboxgl-map') ||
					e.target.closest('.mapboxgl-canvas-container') ||
					e.target.closest('.mapboxgl-ctrl') ||
					e.target.closest('.leaflet-container') ||
					e.target.closest('#x-address-detail-map') ||
					e.target.closest('.x-address-detail-map-wrap') ||
					e.target.closest('#x-map-canvas') ||
					e.target.closest('.x-address-map-canvas') ||
					e.target.closest('button') ||
					e.target.closest('input') ||
					e.target.closest('textarea')
				) {
					touchStartedOnInteractive = true;
					return;
				}

				touchStartedOnInteractive = false;
				sheetTouchStartY = e.touches[0].clientY;
			},
			{ passive: true }
		);

		sheet.addEventListener(
			'touchmove',
			function (e) {
				if (e.touches.length > 1) {
					isMultiTouch = true;
				}
			},
			{ passive: true }
		);

		sheet.addEventListener(
			'touchend',
			function (e) {
				if (isMultiTouch || touchStartedOnInteractive) {
					return;
				}

				if (!e.changedTouches || !e.changedTouches.length) {
					return;
				}

				sheetTouchEndY = e.changedTouches[0].clientY;
				var distance = sheetTouchStartY - sheetTouchEndY;

				// Check scroll container inside sheet if present (e.g. .x-address-detail-content)
				var scrollContent = sheet.querySelector('.x-address-detail-content') || sheet;
				var isAtTop = (sheet.scrollTop <= 0) && (scrollContent.scrollTop <= 0);

				// swipe down to dismiss, matching Cart (-70 threshold)
				if (distance < -70 && isAtTop && sheetTouchStartY > 0) {
					closeDynamicOverlay(overlay);
				}
			},
			{ passive: true }
		);
	}





	function openAddressPicker() {

		closeTopOverlay();


		var overlay =
			createOverlay(
				'x-address-picker-overlay'
			);


		var pluginUrl =
			(
				window.XentraConfig &&
				window.XentraConfig.pluginUrl
			) || '';


		var iconBase =
			pluginUrl
				? pluginUrl + '/assets/icons/'
				: '/wp-content/plugins/xentra-mvp/assets/icons/';


		var icons = {

			rumah:
				iconBase + 'rumah.svg',

			kantor:
				iconBase + 'kantor.svg',

			other:
				iconBase + 'other.svg',

			write:
				iconBase + 'write.svg',

			trash:
				iconBase + 'trash.svg',

			map:
				iconBase + 'mini_map.svg',

			target:
				iconBase + 'target.svg',

			redDot:
				iconBase + 'red_dot.svg',

			search:
				iconBase + 'search.svg',

			thumb:
				iconBase + 'thumb.png',

			plusLime:
				iconBase + 'plus_lime.svg'
		};


		overlay.innerHTML =
			'<div class="x-sheet-inner x-address-picker-sheet" ' +
				'style="' +
					'height:88vh;' +
					'max-height:88vh;' +
					'padding:0;' +
					'overflow:hidden;' +
					'border-radius:24px 24px 0 0;' +
					'background:#fff;' +
					'font-family:\'Plus Jakarta Sans\',sans-serif;' +
					'color:#222;' +
					'display:flex;' +
					'flex-direction:column;' +
				'">' +

				'<div style="' +
					'flex:0 0 auto;' +
					'padding:8px 20px 0;' +
				'">' +

					'<div style="' +
						'width:42px;height:4px;margin:0 auto 18px;border-radius:999px;background:#c9c9c9;' +
					'"></div>' +

					'<div style="' +
						'font-family:\'Plus Jakarta Sans\',sans-serif;font-size:19px;line-height:25px;font-weight:700;color:#222;margin-bottom:18px;' +
					'">Pilih lokasi</div>' +

					'<div style="' +
						'display:flex;align-items:center;gap:8px;height:50px;padding:0 12px;border:1px solid #ddd;border-radius:25px;background:#f7f7f7;' +
					'">' +

						'<img src="' +
							esc(icons.redDot) +
							'" alt="" style="width:18px;height:18px;object-fit:contain;flex:0 0 18px;">' +

						'<input type="text" id="x-address-search-input" ' +
							'placeholder="Cari alamat" autocomplete="off" spellcheck="false" ' +
							'style="' +
								'flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;' +
								'font-family:\'Plus Jakarta Sans\',sans-serif;font-size:14px;color:#444;' +
							'">' +

						'<button type="button" id="x-address-search-submit" aria-label="Cari" ' +
							'style="' +
								'width:24px;height:24px;padding:0;border:0;background:transparent;display:flex;align-items:center;justify-content:center;' +
								'font-family:\'Plus Jakarta Sans\',sans-serif;' +
							'">' +

							'<img src="' +
								esc(icons.search) +
								'" alt="" style="width:20px;height:20px;object-fit:contain;">' +

						'</button>' +

					'</div>' +

					'<div style="' +
						'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;margin-bottom:14px;' +
					'">' +

						'<button type="button" id="x-address-current" ' +
							'style="' +
								'height:42px;padding:0 10px;border:1px solid #ddd;border-radius:21px;background:#fff;' +
								'display:flex;align-items:center;justify-content:center;gap:7px;' +
								'font-family:\'Plus Jakarta Sans\',sans-serif;font-size:12px;color:#666;cursor:pointer;' +
							'">' +

							'<img src="' +
								esc(icons.target) +
								'" alt="" style="width:18px;height:18px;object-fit:contain;">' +

							'<span>Lokasimu saat ini</span>' +

						'</button>' +

						'<button type="button" id="x-address-map" ' +
							'style="' +
								'height:42px;padding:0 10px;border:1px solid #ddd;border-radius:21px;background:#fff;' +
								'display:flex;align-items:center;justify-content:center;gap:7px;' +
								'font-family:\'Plus Jakarta Sans\',sans-serif;font-size:12px;color:#666;cursor:pointer;' +
							'">' +

							'<img src="' +
								esc(icons.map) +
								'" alt="" style="width:18px;height:18px;object-fit:contain;">' +

							'<span>Pilih lewat peta</span>' +

						'</button>' +

					'</div>' +

				'</div>' +

				'<div style="height:1px;background:#eee;flex:0 0 1px;"></div>' +

				'<div id="x-address-favorite-content" ' +
					'style="' +
						'flex:1 1 auto;min-height:0;overflow-y:auto;padding:18px 20px 14px;' +
						'font-family:\'Plus Jakarta Sans\',sans-serif;' +
					'">' +
				'</div>' +

				/* Sticky white footer for Tambah alamat button */
				'<div id="x-address-picker-footer" ' +
					'style="' +
						'flex:0 0 auto;' +
						'background:#fff;' +
						'padding:12px 20px calc(16px + env(safe-area-inset-bottom));' +
						'border-top:1px solid #f0f0f0;' +
						'z-index:10;' +
						'box-shadow:0 -4px 14px rgba(0,0,0,0.04);' +
					'">' +

					'<button type="button" id="x-address-add-favorite" ' +
						'style="' +
							'width:100%;height:46px;border:1px solid #d4d4d4;border-radius:23px;background:#fff;color:#222;' +
							'font-family:\'Plus Jakarta Sans\',sans-serif;font-size:14px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer;' +
						'">' +

						'<svg width="20" height="20" viewBox="0 0 24 24" fill="#00A637">' +
							'<circle cx="12" cy="12" r="10" fill="#00A637"/>' +
							'<path d="M12 7v10M7 12h10" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>' +
						'</svg>' +

						'<span>Tambah alamat</span>' +

					'</button>' +

				'</div>' +

			'</div>';


		openDynamicOverlay(
			overlay
		);

		overlay.style.fontFamily =
			'Plus Jakarta Sans, sans-serif';


		var input =
			document.getElementById(
				'x-address-search-input'
			);

		var content =
			document.getElementById(
				'x-address-favorite-content'
			);


		/*
		 * Browser-side source of truth for this page.
		 *
		 * - Memory state survives opening/closing the sheet.
		 * - localStorage survives a page reload.
		 * - Server is synchronized only once per page.
		 */
		function ensureBrowserFavorites() {

			if (
				Array.isArray(
					state.favoriteAddresses
				)
			) {
				return state.favoriteAddresses;
			}


			try {

				var stored =
					localStorage.getItem(
						FAVORITES_STORAGE_KEY
					);

				if (stored) {

					var parsed =
						JSON.parse(
							stored
						);

					if (
						Array.isArray(
							parsed
						)
					) {

						state.favoriteAddresses =
							parsed;

						return parsed;
					}
				}

			} catch (e) {}


			state.favoriteAddresses =
				[];

			return state.favoriteAddresses;
		}


		function cacheFavorites(
			items
		) {

			state.favoriteAddresses =
				Array.isArray(items)
					? items.slice()
					: [];


			try {

				localStorage.setItem(
					FAVORITES_STORAGE_KEY,
					JSON.stringify(
						state.favoriteAddresses
					)
				);

			} catch (e) {}


			return state.favoriteAddresses;
		}


		function readCachedFavorites() {

			return ensureBrowserFavorites();
		}


		function iconForLabel(
			label
		) {

			var value =
				String(label || '')
					.toLowerCase();

			if (value === 'rumah') {
				return icons.rumah;
			}

			if (value === 'kantor') {
				return icons.kantor;
			}

			return icons.other;
		}


		function bindAddButton() {

			var button =
				overlay.querySelector(
					'#x-address-add-favorite'
				);

			if (!button) {
				return;
			}


			if (
				button.dataset.bound === '1'
			) {
				return;
			}


			button.dataset.bound =
				'1';


			button.addEventListener(
				'click',
				function () {
					state.orderNote = '';
					try {
						localStorage.removeItem(NOTE_STORAGE_KEY);
					} catch (e) {}

					closeDynamicOverlay(overlay);

					openMapSheet({});
				}
			);
		}


		function renderEmptyFavorites() {

			content.innerHTML =
				'<div style="padding-top:2px;font-family:\'Plus Jakarta Sans\',sans-serif;">' +

					'<div style="font-family:\'Plus Jakarta Sans\',sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#222;margin-bottom:18px;">Alamat favorit</div>' +

					'<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:20px;">' +

						'<img src="' +
							esc(icons.thumb) +
							'" alt="" style="width:82px;height:82px;object-fit:contain;flex:0 0 82px;">' +

						'<div style="padding-top:3px;">' +

							'<strong style="display:block;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:15px;line-height:20px;font-weight:700;color:#222;margin-bottom:4px;">Punya alamat yang sering dipakai?</strong>' +

							'<p style="margin:0;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:13px;line-height:18px;color:#666;">Disimpan, yuk! Biar gak ribet ngetik manual tiap kali kamu order di Bangjo.</p>' +

						'</div>' +

					'</div>' +

				'</div>';

			bindAddButton();
		}


		function renderFavorites(
			items
		) {

			if (
				!Array.isArray(items) ||
				!items.length
			) {

				renderEmptyFavorites();

				return;
			}


			content.innerHTML =
				'<div style="font-family:\'Plus Jakarta Sans\',sans-serif;">' +

					'<div style="font-family:\'Plus Jakarta Sans\',sans-serif;font-size:18px;line-height:24px;font-weight:700;color:#222;margin-bottom:16px;">Alamat favorit</div>' +

					'<div id="x-address-favorite-list"></div>' +

				'</div>';

			bindAddButton();


			var list =
				document.getElementById(
					'x-address-favorite-list'
				);


			items.forEach(
				function (
					item
				) {

					var row =
						document.createElement(
							'div'
						);

					row.className =
						'x-address-favorite-card';

					row.dataset.addressId =
						item.id || '';


					row.style.cssText =
						'position:relative;display:flex;align-items:flex-start;gap:12px;padding:14px 14px;margin-bottom:10px;border:1px solid #e1e1e1;border-radius:16px;background:#fff;cursor:pointer;font-family:\'Plus Jakarta Sans\',sans-serif;';


					var detailHtml = item.detail
						? '<div class="x-fav-detail" style="margin-top:6px;padding-left:8px;border-left:2px solid #bbb;font-style:italic;font-size:12px;line-height:17px;color:#777;">' + esc(item.detail) + '</div>'
						: '';

					var noteText = item.driver_note || item.note || '';
					var noteHtml = noteText
						? '<div class="x-fav-note" style="margin-top:6px;font-size:12px;line-height:17px;"><strong style="color:#222;font-weight:700;">Catatan driver:</strong> <span style="color:#666;font-weight:400;">' + esc(noteText) + '</span></div>'
						: '';

					row.innerHTML =
						'<div class="x-fav-card-body" style="flex:1;min-width:0;padding-right:10px;">' +
							'<strong class="x-fav-title" style="display:block;font-size:15px;line-height:20px;font-weight:700;color:#222;">' +
								esc(item.label || item.title || item.name || 'Alamat') +
							'</strong>' +
							'<div class="x-fav-address" style="margin-top:4px;font-size:13px;line-height:18px;color:#666;">' +
								esc(item.formatted_address || '') +
							'</div>' +
							detailHtml +
							noteHtml +
						'</div>' +
						'<button type="button" class="x-fav-menu-btn" aria-label="Kelola alamat" style="width:34px;height:34px;flex:0 0 34px;border:0;border-radius:50%;background:#f4f4f4;display:flex;align-items:center;justify-content:center;font-size:16px;color:#666;cursor:pointer;">•••</button>';

					list.appendChild(
						row
					);


					var menuButton =
						row.querySelector(
							'.x-fav-menu-btn'
						);


					row.addEventListener(
						'click',
						function () {

							var chosen =
								Object.assign(
									{},
									item
								);

							setAddress(
								chosen
							);

							closeDynamicOverlay(overlay);
						}
					);


					menuButton.addEventListener(
						'click',
						function (event) {

							event.stopPropagation();


							var existing =
								document.getElementById(
									'x-address-action-menu'
								);

							if (existing) {
								existing.remove();
							}


							var menu =
								document.createElement(
									'div'
								);

							menu.id =
								'x-address-action-menu';


							var rect =
								menuButton.getBoundingClientRect();

							var menuWidth =
								180;

							var menuHeight =
								116;


							var left =
								Math.min(
									Math.max(
										12,
										rect.right -
										menuWidth
									),
									window.innerWidth -
									menuWidth -
									12
								);


							var top =
								rect.bottom +
								8;


							if (
								top +
								menuHeight +
								12 >
								window.innerHeight
							) {

								top =
									rect.top -
									menuHeight -
									8;
							}


							menu.style.cssText =
								'position:fixed;left:' +
								left +
								'px;top:' +
								top +
								'px;z-index:2147483001;width:' +
								menuWidth +
								'px;background:#fff;border-radius:18px;box-shadow:0 8px 28px rgba(0,0,0,.16);overflow:hidden;font-family:\'Plus Jakarta Sans\',sans-serif;';


							menu.innerHTML =
								'<button type="button" data-action="edit" style="width:100%;height:58px;border:0;border-bottom:1px solid #eee;background:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 18px;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:15px;color:#444;">' +
									'<span>Ubah</span>' +
									'<img src="' +
										esc(icons.write) +
										'" alt="" style="width:20px;height:20px;object-fit:contain;">' +
								'</button>' +

								'<button type="button" data-action="delete" style="width:100%;height:58px;border:0;background:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 18px;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:15px;color:#444;">' +
									'<span>Hapus</span>' +
									'<img src="' +
										esc(icons.trash) +
										'" alt="" style="width:20px;height:20px;object-fit:contain;">' +
								'</button>';


							document.body.appendChild(
								menu
							);


							function closeMenu() {

								if (
									menu &&
									menu.isConnected
								) {
									menu.remove();
								}

								document.removeEventListener(
									'click',
									outsideClick
								);
							}


							function outsideClick(
								clickEvent
							) {

								if (
									!menu.contains(
										clickEvent.target
									) &&
									clickEvent.target !==
										menuButton
								) {

									closeMenu();
								}
							}


							setTimeout(
								function () {

									document.addEventListener(
										'click',
										outsideClick
									);

								},
								0
							);


							menu.addEventListener(
								'click',
								function (
									menuEvent
								) {

									var actionButton =
										menuEvent.target.closest(
											'[data-action]'
										);

									if (!actionButton) {
										return;
									}


									var action =
										actionButton.dataset.action;


									closeMenu();


									if (
										action ===
										'edit'
									) {

										closeDynamicOverlay(overlay);

										var itemNote = String(item.driver_note || item.note || '').trim();
										state.orderNote = itemNote;
										try {
											if (itemNote) {
												localStorage.setItem(NOTE_STORAGE_KEY, itemNote);
											} else {
												localStorage.removeItem(NOTE_STORAGE_KEY);
											}
										} catch (e) {}

										openAddressDetailSheet(
											Object.assign(
												{},
												item
											)
										);

										return;
									}


									if (
										action ===
										'delete'
									) {

										openDeleteConfirmation(
											item,
											function () {
												renderFavorites(
													state.favoriteAddresses ||
													[]
												);
											}
										);

									}

								}
							);

						}
					);

				}
			);
		}



		async function openDeleteConfirmation(
			item,
			onDeleted
		) {

			var existing =
				document.getElementById(
					'x-address-delete-confirm'
				);

			if (existing) {
				existing.remove();
			}


			var confirmOverlay =
				document.createElement(
					'div'
				);

			confirmOverlay.id =
				'x-address-delete-confirm';

			confirmOverlay.style.cssText =
				'position:fixed;' +
				'inset:0;' +
				'z-index:2147483005;' +
				'background:rgba(0,0,0,.28);' +
				'display:flex;' +
				'align-items:flex-end;' +
				'justify-content:center;' +
				'font-family:\'Plus Jakarta Sans\',sans-serif;';


			var sheet =
				document.createElement(
					'div'
				);

			sheet.style.cssText =
				'width:100%;' +
				'max-width:520px;' +
				'background:#fff;' +
				'border-radius:24px 24px 0 0;' +
				'padding:10px 28px calc(18px + env(safe-area-inset-bottom));' +
				'box-sizing:border-box;' +
				'text-align:center;' +
				'font-family:\'Plus Jakarta Sans\',sans-serif;';


			var handle =
				document.createElement(
					'div'
				);

			handle.style.cssText =
				'width:42px;height:4px;margin:0 auto 20px;border-radius:999px;background:#c8c8c8;';


			var image =
				document.createElement(
					'img'
				);

			image.src =
				(
					window.XentraConfig &&
					window.XentraConfig.pluginUrl
						? window.XentraConfig.pluginUrl +
							'/assets/icons/delete_konfirmasi_address.png'
						: '/wp-content/plugins/xentra-mvp/assets/icons/delete_konfirmasi_address.png'
				);

			image.alt = '';

			image.style.cssText =
				'display:block;width:min(100%,360px);height:auto;margin:6px auto 18px;object-fit:contain;';


			var title =
				document.createElement(
					'h3'
				);

			title.textContent =
				'Mau hapus alamat ini?';

			title.style.cssText =
				'margin:0 0 12px;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:22px;line-height:30px;font-weight:700;color:#222;';


			var description =
				document.createElement(
					'p'
				);

			description.textContent =
				'Nanti kamu harus ngetik lagi tiap mau pakai alamat ini di semua layanan Bangjo.';

			description.style.cssText =
				'margin:0 auto 24px;max-width:520px;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:16px;line-height:22px;color:#555;';


			var actions =
				document.createElement(
					'div'
				);

			actions.style.cssText =
				'display:grid;grid-template-columns:1fr 1fr;gap:14px;font-family:\'Plus Jakarta Sans\',sans-serif;';


			var cancel =
				document.createElement(
					'button'
				);

			cancel.type =
				'button';

			cancel.textContent =
				'Enggak, kembali';

			cancel.style.cssText =
				'height:50px;border:1.5px solid #dcdcdc;border-radius:25px;background:#fff;color:#222;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;';


			var remove =
				document.createElement(
					'button'
				);

			remove.type =
				'button';

			remove.textContent =
				'Iya, hapus';

			remove.style.cssText =
				'height:50px;border:0;border-radius:25px;background:#b6ff00;color:#111;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;';


			actions.appendChild(
				cancel
			);

			actions.appendChild(
				remove
			);

			sheet.appendChild(
				handle
			);

			sheet.appendChild(
				image
			);

			sheet.appendChild(
				title
			);

			sheet.appendChild(
				description
			);

			sheet.appendChild(
				actions
			);

			confirmOverlay.appendChild(
				sheet
			);

			document.body.appendChild(
				confirmOverlay
			);


			function closeConfirm() {

				if (
					confirmOverlay &&
					confirmOverlay.isConnected
				) {

					confirmOverlay.remove();
				}
			}


			cancel.addEventListener(
				'click',
				function () {

					closeConfirm();
				}
			);


			confirmOverlay.addEventListener(
				'click',
				function (event) {

					if (
						event.target ===
						confirmOverlay
					) {

						closeConfirm();
					}
				}
			);


			remove.addEventListener(
				'click',
				async function () {

					if (
						remove.disabled
					) {
						return;
					}


					remove.disabled =
						true;

					remove.textContent =
						'Menghapus...';


					closeConfirm();


					var oldFavorites =
						Array.isArray(
							state.favoriteAddresses
						)
							? state.favoriteAddresses.slice()
							: [];


					var fresh =
						oldFavorites.filter(
							function (favorite) {

								return String(
									favorite.id || ''
								) !==
									String(
										item.id || ''
									);
							}
						);


					/*
					 * Browser-side UI is updated first.
					 * No GET is performed here.
					 */
					cacheFavorites(
						fresh
					);


					if (
						fresh.length
					) {

						renderFavorites(
							fresh
						);

					} else {

						renderEmptyFavorites();
					}


					/*
					 * If deleted address was the active checkout address (or no favorites left),
					 * clear checkout address state so the empty card + warning appears.
					 */
					if (
						!fresh.length ||
						(state.address && (
							String(state.address.id || '') === String(item.id || '') ||
							state.address.formatted_address === item.formatted_address ||
							state.address.name === (item.name || item.label || item.title)
						))
					) {
						clearAddress();
					}


					try {

						await api(
							'/address/delete?client_id=' +
							encodeURIComponent(
								CLIENT_ID
							) +
							'&address_id=' +
							encodeURIComponent(
								item.id
							),
							{
								method:
									'DELETE'
							}
						);

					} catch (error) {

						/*
						 * Roll back browser state if server
						 * rejects the deletion.
						 */
						cacheFavorites(
							oldFavorites
						);


						if (
							oldFavorites.length
						) {

							renderFavorites(
								oldFavorites
							);

						} else {

							renderEmptyFavorites();
						}


						showError(
							error.message ||
							'Gagal menghapus alamat.'
						);

						return;
					}


					if (
						typeof onDeleted ===
						'function'
					) {

						onDeleted();
					}
				}
			);
		}

		async function loadFavorites(
			forceServerSync
		) {

			/*
			 * Normal sheet opening:
			 * render memory state immediately and DO NOT GET again.
			 */
			var current =
				ensureBrowserFavorites();

			renderFavorites(
				current
			);


			/*
			 * Server is synchronized once per page.
			 * Explicit forceServerSync is reserved for future
			 * authenticated refresh/recovery flows.
			 */
			if (
				state.favoriteAddressesFetched ||
				forceServerSync === false
			) {
				return;
			}


			state.favoriteAddressesFetched =
				true;


			try {

				var favorites =
					await api(
						'/address/list?client_id=' +
						encodeURIComponent(
							CLIENT_ID
						)
					);


				if (
					Array.isArray(
						favorites
					)
				) {

					cacheFavorites(
						favorites
					);

					if (
						favorites.length
					) {

						renderFavorites(
							favorites
						);

					} else {

						renderEmptyFavorites();

						clearAddress();
					}
				}

			} catch (error) {

				/*
				 * Keep browser state if server sync fails.
				 * The UI is already usable.
				 */
			}
		}


		function renderSearchError(
			message
		) {

			content.innerHTML =
				'<div style="padding:28px 8px;text-align:center;font-family:\'Plus Jakarta Sans\',sans-serif;">' +

					'<strong style="display:block;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:16px;color:#222;margin-bottom:7px;">Lokasi tidak ditemukan</strong>' +

					'<p style="margin:0;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:13px;line-height:19px;color:#777;">' +
						esc(message) +
					'</p>' +

				'</div>';
		}


		async function search(
			query
		) {

			if (
				query.length < 2
			) {

				renderFavorites(
					ensureBrowserFavorites()
				);

				return;
			}


			content.innerHTML =
				'<div style="padding:22px 8px;text-align:center;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:13px;color:#888;">Mencari alamat...</div>';


			try {

				var searchUrl = '/address/search?q=' + encodeURIComponent(query);

				if (state.address && state.address.lat && state.address.lng) {
					searchUrl += '&lat=' + encodeURIComponent(state.address.lat) + '&lng=' + encodeURIComponent(state.address.lng);
				} else if (SETTINGS.maps && SETTINGS.maps.restaurant_lat && SETTINGS.maps.restaurant_lng) {
					searchUrl += '&lat=' + encodeURIComponent(SETTINGS.maps.restaurant_lat) + '&lng=' + encodeURIComponent(SETTINGS.maps.restaurant_lng);
				}

				var data =
					await api(searchUrl);


				if (
					!Array.isArray(data) ||
					!data.length
				) {

					renderSearchError(
						'Cek ejaan alamat atau pilih lewat peta untuk mencari alamat pengiriman.'
					);

					return;
				}


				content.innerHTML =
					'<div style="padding-top:4px;font-family:\'Plus Jakarta Sans\',sans-serif;">' +

						data.map(
							function (
								item
							) {

								return `
									<button
										type="button"
										class="x-address-result"
										data-lat="${esc(item.lat)}"
										data-lng="${esc(item.lng)}"
										data-address="${esc(item.description || item.address || '')}"
										data-title="${esc(item.main_text || item.title || '')}"
										style="
											width:100%;
											display:flex;
											align-items:flex-start;
											gap:10px;
											padding:12px 0;
											border:0;
											border-bottom:1px solid #eee;
											background:#fff;
											text-align:left;
											font-family:'Plus Jakarta Sans',sans-serif;
										"
									>
										<img src="${esc(icons.redDot)}" alt="" style="width:20px;height:20px;object-fit:contain;flex:0 0 20px;">
										<span style="min-width:0;font-family:'Plus Jakarta Sans',sans-serif;">
											<strong style="display:block;font-family:'Plus Jakarta Sans',sans-serif;font-size:14px;line-height:18px;color:#222;">${esc(item.main_text || item.description || '')}</strong>
											<small style="display:block;margin-top:3px;font-family:'Plus Jakarta Sans',sans-serif;font-size:12px;line-height:17px;color:#777;">${esc(item.secondary_text || item.address || '')}</small>
										</span>
									</button>
								`;
							}
						).join('') +

					'</div>';
			} catch (error) {

				renderSearchError(
					error.message
				);
			}
		}


		var timer =
			null;


		input.addEventListener(
			'input',
			function () {

				clearTimeout(
					timer
				);

				timer =
					setTimeout(
						function () {

							search(
								input.value.trim()
							);

						},
						350
					);
			}
		);


		input.addEventListener(
			'keydown',
			function (event) {

				if (
					event.key ===
					'Enter'
				) {

					event.preventDefault();

					search(
						input.value.trim()
					);
				}
			}
		);


		document.getElementById(
			'x-address-search-submit'
		).addEventListener(
			'click',
			function () {

				search(
					input.value.trim()
				);
			}
		);


		var currentBtn =
			overlay.querySelector(
				'#x-address-current'
			);

		if (currentBtn) {
			currentBtn.addEventListener(
				'click',
				async function () {

					if (
						!window.XentraLocation
					) {

						renderSearchError(
							'GPS tidak tersedia.'
						);

						return;
					}


					content.innerHTML =
						'<div style="padding:22px 8px;text-align:center;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:13px;color:#888;">Mencari lokasimu...</div>';


					try {

						var position =
							await
							window.XentraLocation
								.getCurrentPosition();


						var reverse =
							await api(
								'/address/reverse?lat=' +
								encodeURIComponent(
									position.lat
								) +
								'&lng=' +
								encodeURIComponent(
									position.lng
								)
							);


						if (
							!reverse ||
							!reverse.formatted_address
						) {

							throw new Error(
								'Alamat lokasi saat ini tidak ditemukan.'
							);
						}


						closeDynamicOverlay(overlay);


						openAddressDetailSheet(
							{
								formatted_address:
									reverse.formatted_address,

								name:
									reverse.name ||
									'Lokasi terpilih',

								lat:
									position.lat,

								lng:
									position.lng
							}
						);

					} catch (error) {

						renderSearchError(
							error.message
						);
					}
				}
			);
		}


		var mapBtn =
			overlay.querySelector(
				'#x-address-map'
			);

		if (mapBtn) {
			mapBtn.addEventListener(
				'click',
				function () {
					state.orderNote = '';
					try {
						localStorage.removeItem(NOTE_STORAGE_KEY);
					} catch (e) {}

					closeDynamicOverlay(overlay);

					openMapSheet({});
				}
			);
		}


		content.addEventListener(
			'click',
			function (
				event
			) {

				var result =
					event.target.closest(
						'.x-address-result'
					);

				if (!result) {
					return;
				}


				closeDynamicOverlay(overlay);


				openAddressDetailSheet(
					{
						formatted_address:
							result.dataset.address,

						name:
							result.dataset.title,

						lat:
							number(
								result.dataset.lat
							),

						lng:
							number(
								result.dataset.lng
							)
					}
				);
			}
		);


		overlay.addEventListener(
			'click',
			function (event) {

				if (
					event.target ===
						overlay ||
					event.target.closest(
						'[data-address-picker-close]'
					)
				) {

					closeDynamicOverlay(overlay);
				}
			}
		);

		bindDynamicOverlayDismiss(overlay, '.x-address-picker-sheet');

		bindAddButton();

		loadFavorites();
	}


	/* =========================================================
	 * ADDRESS DETAIL SHEET
	 * ========================================================= */

	function openAddressDetailSheet(address) {

		address =
			Object.assign(
				{},
				address || {}
			);

		// Synchronize state.orderNote with this address's driver_note (or reset to null/empty for new address)
		if (address && address.driver_note) {
			state.orderNote = String(address.driver_note).trim();
			try {
				localStorage.setItem(NOTE_STORAGE_KEY, state.orderNote);
			} catch (e) {}
		} else {
			state.orderNote = '';
			try {
				localStorage.removeItem(NOTE_STORAGE_KEY);
			} catch (e) {}
		}

		var overlay =
			createOverlay(
				'x-address-detail-overlay'
			);


		var pluginUrl =
			(
				window.XentraConfig &&
				window.XentraConfig.pluginUrl
			) || '';

		var iconBase =
			pluginUrl
				? pluginUrl +
					'/assets/icons/'
				: '/wp-content/plugins/xentra-mvp/assets/icons/';

		var icons = {
			write: iconBase + 'write.svg',
			file: iconBase + 'file.svg',
			redDot: iconBase + 'red_dot.svg'
		};

		/*
		 * LOCKED DETAIL ADDRESS UI (Gambar 2):
		 *
		 * MAP (Top half):
		 * - Fixed center orange/red pointer pin
		 * - Back arrow button ← (returns to map picker Gambar 1)
		 * - GPS locate crosshair button
		 *
		 * FORM (Middle scrollable area):
		 * - Sheet header: "Detail alamat" + "Ubah" button (returns to map picker Gambar 1)
		 * - Selected location card: red/orange target dot + bold title + address text (natural white bg, no grey card box)
		 * - Divider line
		 * - Nama alamat (wajib) input
		 * - Detail lokasi/patokan (optional) input
		 * - Simpan sebagai favorit checkbox + Catatan driver button (lime, write.svg when filled, file.svg when empty)
		 *
		 * FOOTER (Stay on top at bottom):
		 * - Konfirmasi CTA button (enabled lime only when Nama alamat is filled)
		 */

		if (address && (address.driver_note != null || address.note != null)) {
			var addrNote = String(address.driver_note || address.note || '').trim();
			state.orderNote = addrNote;
			try {
				if (addrNote) {
					localStorage.setItem(NOTE_STORAGE_KEY, addrNote);
				} else {
					localStorage.removeItem(NOTE_STORAGE_KEY);
				}
			} catch (e) {}
		}

		var hasInitialNote = Boolean(state.orderNote || address.driver_note || address.note);
		var initialDriverIcon = hasInitialNote
			? icons.write
			: icons.file;

		overlay.innerHTML =
			'<div class="x-sheet-inner x-address-detail-sheet" ' +
				'style="' +
					'height:94vh;' +
					'max-height:94vh;' +
					'padding:0;' +
					'overflow:hidden;' +
					'border-radius:24px 24px 0 0;' +
					'display:flex;' +
					'flex-direction:column;' +
				'">' +

				'<div ' +
					'class="x-address-detail-map-wrap" ' +
					'style="' +
						'height:38%;' +
						'min-height:220px;' +
						'position:relative;' +
						'flex:0 0 38%;' +
					'">' +

					'<div ' +
						'id="x-address-detail-map" ' +
						'style="' +
							'position:absolute;' +
							'inset:0;' +
							'background:#eee;' +
						'">' +
					'</div>' +

					/* fixed orange pointer */
					'<div ' +
						'style="' +
							'position:absolute;' +
							'left:50%;' +
							'top:50%;' +
							'width:48px;' +
							'height:60px;' +
							'transform:translate(-50%,-100%);' +
							'z-index:1000;' +
							'pointer-events:none;' +
						'">' +

						'<div style="' +
							'position:absolute;' +
							'left:4px;' +
							'top:0;' +
							'width:40px;' +
							'height:40px;' +
							'border-radius:50% 50% 50% 0;' +
							'background:#ff6a00;' +
							'transform:rotate(-45deg);' +
							'box-shadow:0 2px 6px rgba(0,0,0,.24);' +
						'">' +

							'<span style="' +
								'position:absolute;' +
								'left:12px;' +
								'top:12px;' +
								'width:16px;' +
								'height:16px;' +
								'border-radius:50%;' +
								'background:#fff;' +
							'"></span>' +

						'</div>' +

					'</div>' +

					/* back */
					'<button type="button" ' +
						'data-detail-close="1" ' +
						'aria-label="Kembali" ' +
						'style="' +
							'position:absolute;' +
							'left:18px;' +
							'bottom:18px;' +
							'z-index:1001;' +
							'width:52px;' +
							'height:52px;' +
							'padding:0;' +
							'border:0;' +
							'border-radius:50%;' +
							'background:#fff;' +
							'box-shadow:0 2px 10px rgba(0,0,0,.14);' +
							'display:flex;' +
							'align-items:center;' +
							'justify-content:center;' +
							'cursor:pointer;' +
						'">' +
						'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#222" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
							'<path d="M19 12H5M12 19l-7-7 7-7"/>' +
						'</svg>' +
					'</button>' +

					/* GPS target */
					'<button type="button" ' +
						'id="x-address-detail-locate" ' +
						'aria-label="Lokasi saya saat ini" ' +
						'style="' +
							'position:absolute;' +
							'right:18px;' +
							'bottom:18px;' +
							'z-index:1001;' +
							'width:52px;' +
							'height:52px;' +
							'padding:0;' +
							'border:0;' +
							'border-radius:50%;' +
							'background:#fff;' +
							'box-shadow:0 2px 10px rgba(0,0,0,.14);' +
							'display:flex;' +
							'align-items:center;' +
							'justify-content:center;' +
							'cursor:pointer;' +
						'">' +

						'<svg width="24" height="24" viewBox="0 0 24 24" ' +
							'fill="none" stroke="#222" stroke-width="1.9" ' +
							'stroke-linecap="round" stroke-linejoin="round">' +
							'<circle cx="12" cy="12" r="7"></circle>' +
							'<path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path>' +
							'<circle cx="12" cy="12" r="2.2" fill="#222" stroke="none"></circle>' +
						'</svg>' +

					'</button>' +

				'</div>' +

				'<div ' +
					'class="x-address-detail-content" ' +
					'style="' +
						'flex:1 1 auto;' +
						'min-height:0;' +
						'overflow-y:auto;' +
						'padding:12px 18px 16px;' +
					'">' +

					'<div class="x-sheet-handle" style="' +
						'width:42px;' +
						'height:4px;' +
						'margin:0 auto 14px;' +
						'border-radius:999px;' +
						'background:#c8c8c8;' +
					'"></div>' +

					'<div ' +
						'style="' +
							'display:flex;' +
							'align-items:center;' +
							'justify-content:space-between;' +
							'gap:12px;' +
							'margin-bottom:14px;' +
						'">' +

						'<h3 style="' +
							'margin:0;' +
							'font-size:18px;' +
							'line-height:24px;' +
							'font-weight:700;' +
							'color:#222;' +
						'">Detail alamat</h3>' +

						'<button type="button" ' +
							'id="x-address-change-map" ' +
							'style="' +
								'height:32px;' +
								'padding:0 18px;' +
								'border:0;' +
								'border-radius:20px;' +
								'background:#b6ff00;' +
								'color:#111;' +
								'font-size:13px;' +
								'font-weight:700;' +
								'font-family:inherit;' +
								'cursor:pointer;' +
							'">Ubah</button>' +

					'</div>' +

					'<div class="x-address-detail-selected" ' +
						'style="' +
							'padding:0;' +
							'background:transparent;' +
							'margin-bottom:14px;' +
							'display:flex;' +
							'align-items:flex-start;' +
							'gap:12px;' +
						'">' +

						'<img src="' +
							esc(icons.redDot) +
							'" alt="" style="width:20px;height:20px;object-fit:contain;flex:0 0 20px;margin-top:2px;">' +

						'<div style="min-width:0;">' +

							'<strong id="x-address-detail-place-name" ' +
								'style="' +
									'display:block;' +
									'font-size:16px;' +
									'line-height:22px;' +
									'font-weight:700;' +
									'color:#222;' +
								'">' +
								esc(
									address.name ||
									'Lokasi terpilih'
								) +
							'</strong>' +

							'<div id="x-address-detail-place-address" ' +
								'style="' +
									'margin-top:3px;' +
									'font-size:13px;' +
									'line-height:19px;' +
									'color:#666;' +
								'">' +
								esc(
									address.formatted_address ||
									''
								) +
							'</div>' +

						'</div>' +

					'</div>' +

					'<div style="height:1px;background:#eee;margin:14px 0 16px;"></div>' +

					'<label style="display:block;font-size:14px;font-weight:700;color:#222;margin-bottom:6px;">' +
						'Nama alamat <span style="font-weight:400;color:#888;font-size:12px;">(wajib)</span>' +
					'</label>' +

					'<input type="text" ' +
						'id="x-address-name-input" ' +
						'autocomplete="off" ' +
						'placeholder="Rumah / kantor / lainnya..." ' +
						'value="' +
							esc(
								(address.is_edit || address.id) && address.label ? address.label : ''
							) +
						'" ' +
						'style="' +
							'width:100%;' +
							'height:46px;' +
							'border:1px solid #ddd;' +
							'border-radius:12px;' +
							'padding:0 14px;' +
							'font-size:14px;' +
							'color:#222;' +
							'font-family:\'Plus Jakarta Sans\',sans-serif;' +
							'margin-bottom:14px;' +
							'box-sizing:border-box;' +
						'">' +

					'<label style="display:block;font-size:14px;font-weight:700;color:#222;margin-bottom:6px;">' +
						'Detail lokasi/patokan <span style="font-weight:400;color:#888;font-size:12px;">(optional)</span>' +
					'</label>' +

					'<input type="text" ' +
						'id="x-address-detail-input" ' +
						'placeholder="No Rumah / unit / lantai" ' +
						'value="' +
							esc(
								address.detail || address.landmark || ''
							) +
						'" ' +
						'style="' +
							'width:100%;' +
							'height:46px;' +
							'border:1px solid #ddd;' +
							'border-radius:12px;' +
							'padding:0 14px;' +
							'font-size:14px;' +
							'color:#222;' +
							'font-family:\'Plus Jakarta Sans\',sans-serif;' +
							'margin-bottom:16px;' +
							'box-sizing:border-box;' +
						'">' +

					'<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px;">' +

						'<label class="x-custom-checkbox">' +
							'<input type="checkbox" id="x-address-favorite" ' + (address.is_favorite !== false ? 'checked' : '') + '>' +
							'<span class="x-checkbox-box">' +
								'<svg viewBox="0 0 12 10"><polyline points="1.5 5 4.5 8 10.5 1.5"/></svg>' +
							'</span>' +
							'<span>Simpan sebagai favorit</span>' +
						'</label>' +

						'<button type="button" id="x-address-driver-note-btn" class="x-address-driver-note-btn" ' +
							'style="' +
								'height:36px;' +
								'padding:0 14px;' +
								'border:0;' +
								'border-radius:18px;' +
								'background:#b6ff00;' +
								'color:#111;' +
								'font-size:13px;' +
								'font-weight:700;' +
								'display:inline-flex;' +
								'align-items:center;' +
								'gap:6px;' +
								'cursor:pointer;' +
								'font-family:\'Plus Jakarta Sans\',sans-serif;' +
							'">' +
							'<span id="x-address-driver-note-icon">' +
								'<img src="' + esc(initialDriverIcon) + '" alt="" style="width:15px;height:15px;object-fit:contain;display:block;">' +
							'</span>' +
							'<span id="x-address-driver-note-text">Catatan driver</span>' +
						'</button>' +

					'</div>' +

				'</div>' +

				/* BOTTOM STICKY FOOTER CTA BUTTON */
				'<div class="x-address-detail-footer" ' +
					'style="' +
						'flex:0 0 auto;' +
						'background:#fff;' +
						'padding:12px 18px calc(14px + env(safe-area-inset-bottom));' +
						'box-shadow:0 -4px 16px rgba(0,0,0,0.06);' +
						'z-index:10;' +
					'">' +

					'<button type="button" ' +
						'class="x-address-confirm" ' +
						'id="x-address-confirm" ' +
						'disabled ' +
						'style="' +
							'width:100%;' +
							'height:50px;' +
							'min-height:50px;' +
							'border:0;' +
							'border-radius:25px;' +
							'background:#e5e5e5;' +
							'color:#888;' +
							'font-size:15px;' +
							'font-weight:700;' +
							'font-family:\'Plus Jakarta Sans\',sans-serif;' +
							'cursor:not-allowed;' +
							'transition:all .2s ease;' +
						'">' +
						'Konfirmasi' +
					'</button>' +

				'</div>' +

			'</div>';


		openDynamicOverlay(
			overlay
		);


		var nameInput =
			document.getElementById(
				'x-address-name-input'
			);

		var detailInput =
			document.getElementById(
				'x-address-detail-input'
			);

		var confirmButton =
			document.getElementById(
				'x-address-confirm'
			);

		var favCheckbox =
			document.getElementById(
				'x-address-favorite'
			);

		var driverNoteBtn =
			document.getElementById(
				'x-address-driver-note-btn'
			);

		var nameEl =
			document.getElementById(
				'x-address-detail-place-name'
			);

		var addressEl =
			document.getElementById(
				'x-address-detail-place-address'
			);


		function isComplete() {
			var nameVal =
				nameInput
					? nameInput.value.trim()
					: '';

			return nameVal.length > 0;
		}


		function updateConfirm() {

			var active =
				isComplete();


			if (!confirmButton) {
				return;
			}


			confirmButton.disabled =
				!active;


			confirmButton.style.background =
				active
					? '#b6ff00'
					: '#e5e5e5';

			confirmButton.style.color =
				active
					? '#111'
					: '#888';

			confirmButton.style.cursor =
				active
					? 'pointer'
					: 'not-allowed';
		}


		function updateAddressSummary(
			name,
			formatted
		) {

			address.name =
				name ||
				address.name ||
				'Lokasi terpilih';

			address.formatted_address =
				formatted ||
				address.formatted_address ||
				'';


			if (nameEl) {
				nameEl.textContent =
					address.name;
			}

			if (addressEl) {
				addressEl.textContent =
					address.formatted_address;
			}


			updateConfirm();
		}

		function updateDriverNoteBtnState() {
			var hasNote = Boolean(state.orderNote || address.driver_note);
			var iconEl = document.getElementById('x-address-driver-note-icon');
			if (iconEl) {
				var iconSrc = hasNote
					? icons.write
					: icons.file;
				iconEl.innerHTML = '<img src="' + esc(iconSrc) + '" alt="" style="width:15px;height:15px;object-fit:contain;display:block;">';
			}
		}


		if (nameInput) {
			nameInput.addEventListener(
				'input',
				updateConfirm
			);
		}

		if (detailInput) {
			detailInput.addEventListener(
				'input',
				updateConfirm
			);
		}

		if (driverNoteBtn) {
			driverNoteBtn.addEventListener(
				'click',
				function () {
					openOrderNote();
				}
			);
			updateDriverNoteBtnState();
		}

		updateConfirm();


		/*
		 * Ubah:
		 * return to the map picker.
		 */
		var changeMapBtn =
			overlay.querySelector(
				'#x-address-change-map'
			);

		if (changeMapBtn) {
			changeMapBtn.addEventListener(
				'click',
				function () {

					closeDynamicOverlay(
						overlay
					);

					openMapSheet(
						address
					);
				}
			);
		}


		/*
		 * Close/back:
		 * Returns to map picker (Gambar 1).
		 */
		var detailBackBtn =
			overlay.querySelector(
				'[data-detail-close]'
			);

		if (detailBackBtn) {
			detailBackBtn.addEventListener(
				'click',
				function (event) {
					event.stopPropagation();
					closeDynamicOverlay(overlay);
					openMapSheet(address);
				}
			);
		}


		overlay.addEventListener(
			'click',
			function (event) {

				if (
					event.target === overlay
				) {
					closeDynamicOverlay(overlay);
				}
			}
		);

		/*
		 * Note: Swipe-down dismiss is intentionally disabled on this map layer
		 * to prevent accidental closure while navigating/zooming the map.
		 * Back button and tap backdrop remain fully functional.
		 */


		/*
		 * Confirm:
		 * save favorite if checked, then put the final address
		 * into checkout state.
		 */
		confirmButton.addEventListener(
			'click',
			async function () {

				if (!isComplete()) {
					return;
				}


				var addressName =
					nameInput
						? nameInput.value.trim()
						: '';

				var addressDetail =
					detailInput
						? detailInput.value.trim()
						: '';

				var isFav =
					favCheckbox
						? Boolean(favCheckbox.checked)
						: true;

				var originalId = address.id || null;

				var finalNote = (state.orderNote || address.driver_note || address.note || '').trim();

				var finalAddress =
					Object.assign(
						{},
						address,
						{
							id: originalId || ('fav_' + Date.now()),
							name: addressName,
							label: addressName,
							title: addressName,
							formatted_address: address.formatted_address || '',
							detail: addressDetail,
							landmark: addressDetail,
							lat: number(address.lat),
							lng: number(address.lng),
							driver_note: finalNote,
							note: finalNote,
							is_favorite: isFav
						}
					);


				if (
					finalAddress.is_favorite
				) {

					try {

						var saved =
							await api(
								'/address/save',
								{
									method:'POST',

									body:
										JSON.stringify(
											Object.assign(
												{},
												finalAddress,
												{
													client_id:
														CLIENT_ID
												}
											)
										)
								}
							);


						if (
							saved &&
							saved.id
						) {

							finalAddress.id =
								saved.id;
						}

					} catch (error) {

						showError(
							error.message
						);
					}

					if (
						!Array.isArray(
							state.favoriteAddresses
						)
					) {
						state.favoriteAddresses = [];
					}

					var targetId = String(originalId || finalAddress.id || '');
					var existingIndex =
						state.favoriteAddresses.findIndex(
							function (favorite) {

								return (
									(targetId && String(favorite.id || '') === targetId) ||
									(saved && saved.id && String(favorite.id || '') === String(saved.id)) ||
									(favorite.formatted_address === finalAddress.formatted_address && (favorite.label === finalAddress.label || favorite.name === finalAddress.name))
								);
							}
						);


					if (
						existingIndex >= 0
					) {

						state.favoriteAddresses[
							existingIndex
						] = Object.assign(
							{},
							state.favoriteAddresses[existingIndex],
							finalAddress
						);

					} else if (
						finalAddress.id
					) {

						state.favoriteAddresses.push(
							Object.assign(
								{},
								finalAddress
							)
						);

					}

					try {

						localStorage.setItem(
							FAVORITES_STORAGE_KEY,
							JSON.stringify(
								state.favoriteAddresses
							)
						);

					} catch (e) {}
				}


				setAddress(
					finalAddress
				);

				closeDynamicOverlay(overlay);
			}
		);


		/*
		 * Leaflet map.
		 * Directly uses coordinates chosen from openMapSheet.
		 */
		(async function initDetailMap() {

			var lat =
				number(
					address.lat
				);

			var lng =
				number(
					address.lng
				);


			if (!lat || !lng) {
				try {

					if (
						window.XentraLocation &&
						typeof
							window.XentraLocation
								.getCurrentPosition ===
							'function'
					) {

						var gps =
							await
							window.XentraLocation
								.getCurrentPosition();


						var gpsLat =
							number(
								gps &&
								(
									gps.lat ||
									gps.latitude
								)
							);

						var gpsLng =
							number(
								gps &&
								(
									gps.lng ||
									gps.longitude
								)
							);


						if (
							gpsLat &&
							gpsLng
						) {

							lat =
								gpsLat;

							lng =
								gpsLng;
						}
					}

				} catch (error) {}
			}


			if (!lat || !lng) {

				lat =
					number(
						SETTINGS.maps &&
						SETTINGS.maps.restaurant_lat
					) ||
					-5.3541;

				lng =
					number(
						SETTINGS.maps &&
						SETTINGS.maps.restaurant_lng
					) ||
					104.8138;
			}


			address.lat =
				lat;

			address.lng =
				lng;


			try {
				await loadMapboxGL();

				var hasSpecificTitle = Boolean(address && address.name && address.name !== 'Lokasi terpilih');
				var detailMapInst = createXentraInteractiveMap({
					container: 'x-address-detail-map',
					centerLng: lng,
					centerLat: lat,
					zoom: 17,
					isMiniMap: true,
					onLocationPicked: function (pName, pAddr, pLat, pLng) {
						address.lat = pLat;
						address.lng = pLng;
						if (pAddr) address.formatted_address = pAddr;
						var displayName = hasSpecificTitle ? address.name : (pName || 'Lokasi terpilih');
						updateAddressSummary(displayName, pAddr || address.formatted_address);
					},
					onMapClick: function () {
						closeDynamicOverlay(overlay);
						openMapSheet(address);
					}
				});

				var locateButton = document.getElementById('x-address-detail-locate');
				if (locateButton && detailMapInst) {
					locateButton.addEventListener('click', async function () {
						try {
							var gps = await window.XentraLocation.getCurrentPosition();
							var gpsLat = number(gps && (gps.lat || gps.latitude));
							var gpsLng = number(gps && (gps.lng || gps.longitude));
							if (gpsLat && gpsLng) {
								detailMapInst.flyTo(gpsLat, gpsLng, 17.5);
							}
						} catch (e) {}
					});
				}

			} catch (error) {
				if (addressEl) {
					addressEl.textContent = error.message || 'Peta tidak dapat dimuat.';
				}
			}

		})();

	}


	/* =========================================================
	 * MAP SHEET (MAPBOX GL JS)
	 * ========================================================= */

	function loadMapboxGL() {

		return new Promise(
			function (resolve, reject) {

				if (
					window.mapboxgl &&
					typeof window.mapboxgl.Map === 'function'
				) {
					resolve();
					return;
				}


				var css =
					document.getElementById(
						'xentra-mapbox-css'
					);

				if (!css) {
					css =
						document.createElement(
							'link'
						);
					css.id =
						'xentra-mapbox-css';
					css.rel =
						'stylesheet';
					css.href =
						'https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css';
					document.head.appendChild(
						css
					);
				}


				var existing =
					document.getElementById(
						'xentra-mapbox-js'
					);

				if (existing) {

					if (
						existing.dataset.loaded === '1' ||
						(window.mapboxgl && typeof window.mapboxgl.Map === 'function')
					) {
						resolve();
						return;
					}

					existing.addEventListener(
						'load',
						function () {
							existing.dataset.loaded = '1';
							resolve();
						}
					);

					existing.addEventListener(
						'error',
						function () {
							reject(
								new Error(
									'Peta Mapbox tidak dapat dimuat.'
								)
							);
						}
					);

					return;
				}


				var script =
					document.createElement(
						'script'
					);

				script.id =
					'xentra-mapbox-js';

				script.src =
					'https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.js';

				script.onload =
					function () {
						script.dataset.loaded = '1';
						resolve();
					};

				script.onerror =
					function () {
						reject(
							new Error(
								'Library Mapbox GL tidak dapat dimuat.'
							)
						);
					};

				document.head.appendChild(
					script
				);
			}
		);

	}

	var XENTRA_POI_CACHE = new Map();

	function createXentraInteractiveMap(cfg) {
		var container = typeof cfg.container === 'string' ? document.getElementById(cfg.container) : cfg.container;
		if (!container) return null;

		var centerLng = cfg.centerLng || 104.9785;
		var centerLat = cfg.centerLat || -5.3574;
		var onLocationPicked = typeof cfg.onLocationPicked === 'function' ? cfg.onLocationPicked : null;
		var onMapClick = typeof cfg.onMapClick === 'function' ? cfg.onMapClick : null;
		var isMiniMap = Boolean(cfg.isMiniMap);

		var mapboxToken = (window.XentraConfig && window.XentraConfig.mapboxToken) || 'pk.eyJ1IjoiaWtod2FucyIsImEiOiJjbXQ5c2cwMzYwOW15MnpxdXdpeWU3am45In0.YcX49DH0uXP70aBxVDC-TA';
		window.mapboxgl.accessToken = mapboxToken;

		var map = new window.mapboxgl.Map({
			container: container,
			style: 'mapbox://styles/mapbox/streets-v12',
			center: [centerLng, centerLat],
			zoom: cfg.zoom || (isMiniMap ? 16.5 : 17.2),
			attributionControl: false
		});

		map.addControl(new window.mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

		setTimeout(function () {
			map.resize();
		}, 150);

		var renderedPoiMarkers = new Map();

		function renderPoiToMap(poi) {
			if (!poi || !poi.lat || !poi.lng || !poi.name) return;
			var key = poi.name + '_' + poi.lat.toFixed(5) + '_' + poi.lng.toFixed(5);
			if (renderedPoiMarkers.has(key)) return;

			var nameLower = (poi.name || '').toLowerCase();
			var cats = Array.isArray(poi.category) ? poi.category.join(' ').toLowerCase() : '';
			var maki = (poi.maki || '').toLowerCase();

			// 1. Food / Resto / Warung / Mie / Nasi / Ayam (Orange Fork & Spoon) - FIRST PRIORITY
			var isFood = false;
			if (/pecel|lele|ayam|mie|bakmi|bakso|nasi|soto|bebek|sate|warung|rm\.|rm\b|rumah makan|diner|restaurant|makan|seafood|padang|martabak|burger|pizza|d'master|fried chicken|lesehan|dapur|kitchen|steak|gulai|sop|bubur|pempek|along|bang jo|semar|juju|roni/i.test(nameLower) ||
			    /restaurant|fast_food|fast-food|indonesian restaurant|diner|eatery/i.test(cats) ||
			    /restaurant|fast-food|diner/i.test(maki)) {
				isFood = true;
			}

			// 2. Cafe / Kopi / Boba / Minuman (Purple Coffee Cup)
			var isCafe = false;
			if (!isFood) {
				if (/cafe|café|coffee|kopi|boba|bar\b|lounge|espresso|kedai kopi|angkringan|tea house|sel-sel/i.test(nameLower) ||
				    /^(cafe|coffee_shop|bar)$/i.test(maki) ||
				    (/\b(coffee|cafe|café|boba|tea shop|espresso)\b/i.test(cats))) {
					isCafe = true;
				}
			}

			// 3. Medical / Klinik / Dokter (Red Plus)
			var isMedical = false;
			if (!isFood && !isCafe) {
				if (/health|doctor|clinic|hospital|pharmacy|apotek|med/i.test(cats) ||
				    /doctor|hospital|pharmacy/i.test(maki) ||
				    /klinik|dokter|dr\.|dr\b|apotek|puskesmas|rumah sakit|rs\b/i.test(nameLower)) {
					isMedical = true;
				}
			}

			// 4. Shop / Toko / Swalayan / Jasa (Blue Shopping Bag)
			var isShop = false;
			if (!isFood && !isCafe && !isMedical) {
				if (/shop|shopping|store|toko|market|mart|grocery|bakery|cake|interior|tech|studio|bank|atm/i.test(cats) ||
				    /shop|grocery|bakery|bank/i.test(maki) ||
				    /toko|mart|swalayan|bakery|cake|interior|tech|studio|bank|atm|bri\b|bca\b|mandiri\b/i.test(nameLower)) {
					isShop = true;
				}
			}

			var badgeBg = 'linear-gradient(135deg, #ff7a18 0%, #ff5200 100%)';
			var textColor = '#c2410c';
			var iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#ffffff"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg>';

			if (isFood) {
				badgeBg = 'linear-gradient(135deg, #ff7a18 0%, #ff5200 100%)';
				textColor = '#c2410c';
				iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#ffffff"><path d="M11 9H9V2H7v7H5V2H3v7c0 2.12 1.66 3.84 3.75 3.97V22h2.5v-9.03C11.34 12.84 13 11.12 13 9V2h-2v7zm5-3v8h2.5v8H21V2c-2.76 0-5 2.24-5 4z"/></svg>';
			} else if (isCafe) {
				badgeBg = 'linear-gradient(135deg, #a855f7 0%, #7c3aed 100%)';
				textColor = '#7e22ce';
				iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8h1a4 4 0 0 1 0 8h-1M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8zM6 1v3M10 1v3M14 1v3"/></svg>';
			} else if (isMedical) {
				badgeBg = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
				textColor = '#b91c1c';
				iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#ffffff"><path d="M19 10.5h-5.5V5h-3v5.5H5v3h5.5V19h3v-5.5H19z"/></svg>';
			} else if (isShop) {
				badgeBg = 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)';
				textColor = '#1d4ed8';
				iconSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/></svg>';
			} else {
				badgeBg = 'linear-gradient(135deg, #64748b 0%, #475569 100%)';
				textColor = '#334155';
				iconSvg = '<svg width="11" height="11" viewBox="0 0 24 24" fill="#ffffff"><circle cx="12" cy="12" r="6"/></svg>';
			}

			var el = document.createElement('div');
			el.className = 'x-map-poi-badge';
			el.style.display = 'flex';
			el.style.flexDirection = 'column';
			el.style.alignItems = 'center';
			el.style.cursor = 'pointer';
			el.style.zIndex = '5';
			el.style.userSelect = 'none';

			el.innerHTML =
				'<div style="width:26px;height:26px;border-radius:50%;background:' + badgeBg + ';border:2px solid #ffffff;box-shadow:0 3px 10px rgba(0,0,0,0.22);display:flex;align-items:center;justify-content:center;transition:transform 0.15s ease;">' +
					iconSvg +
				'</div>' +
				'<div style="margin-top:3px;padding:3px 7px;background:#ffffff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.16);border:1px solid rgba(0,0,0,0.06);font-family:\'Plus Jakarta Sans\',sans-serif;font-size:11px;font-weight:700;color:' + textColor + ';white-space:nowrap;max-width:120px;overflow:hidden;text-overflow:ellipsis;pointer-events:none;line-height:1.2;">' +
					esc(poi.name) +
				'</div>';

			el.addEventListener('mouseenter', function () {
				var iconDiv = el.querySelector('div');
				if (iconDiv) iconDiv.style.transform = 'scale(1.18)';
			});
			el.addEventListener('mouseleave', function () {
				var iconDiv = el.querySelector('div');
				if (iconDiv) iconDiv.style.transform = 'scale(1)';
			});

			el.addEventListener('click', function (e) {
				e.stopPropagation();
				if (onLocationPicked) {
					onLocationPicked(poi.name, poi.address || '', poi.lat, poi.lng);
				}
				map.flyTo({
					center: [poi.lng, poi.lat],
					zoom: 17.5,
					essential: true
				});
			});

			var marker = new window.mapboxgl.Marker({
				element: el,
				anchor: 'bottom'
			})
			.setLngLat([poi.lng, poi.lat])
			.addTo(map);

			renderedPoiMarkers.set(key, marker);
		}

		function syncAllCachedPois() {
			if (!map) return;
			XENTRA_POI_CACHE.forEach(function (poi) {
				renderPoiToMap(poi);
			});
		}

		map.on('load', syncAllCachedPois);
		map.on('style.load', syncAllCachedPois);
		map.on('idle', syncAllCachedPois);
		setTimeout(syncAllCachedPois, 200);
		setTimeout(syncAllCachedPois, 600);

		var debounceTimer = null;
		var activeFetchCtrl = null;

		async function fetchAreaPois(cLat, cLng) {
			if (activeFetchCtrl) {
				try { activeFetchCtrl.abort(); } catch (e) {}
			}
			if (typeof AbortController !== 'undefined') {
				activeFetchCtrl = new AbortController();
			}

			try {
				var fetchOpts = activeFetchCtrl ? { signal: activeFetchCtrl.signal } : {};
				var res = await api('/address/reverse?lat=' + encodeURIComponent(cLat) + '&lng=' + encodeURIComponent(cLng), fetchOpts);

				if (res && res.formatted_address) {
					if (Array.isArray(res.nearby_pois)) {
						res.nearby_pois.forEach(function (p) {
							if (p.name && p.lat && p.lng) {
								var k = p.name + '_' + p.lat.toFixed(5) + '_' + p.lng.toFixed(5);
								XENTRA_POI_CACHE.set(k, p);
								renderPoiToMap(p);
							}
						});
					}
					if (onLocationPicked) {
						onLocationPicked(res.name || 'Lokasi terpilih', res.formatted_address, cLat, cLng);
					}
				}
			} catch (err) {
				if (err && err.name !== 'AbortError') {
					// Fallback
				}
			}
		}

		function onMoveEnd() {
			var center = map.getCenter();
			syncAllCachedPois();
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(function () {
				fetchAreaPois(center.lat, center.lng);
			}, 300);
		}

		map.on('moveend', onMoveEnd);

		map.on('click', function (e) {
			if (onMapClick) {
				onMapClick(e.lngLat.lat, e.lngLat.lng);
			} else {
				var bbox = [
					[e.point.x - 20, e.point.y - 20],
					[e.point.x + 20, e.point.y + 20]
				];
				var features = map.queryRenderedFeatures(bbox);
				var poiFeature = features.find(function (f) {
					return f.properties && (f.properties.name || f.properties.name_id || f.properties.name_en || f.properties.title);
				});
				var pName = poiFeature && poiFeature.properties ? (poiFeature.properties.name || poiFeature.properties.name_id || poiFeature.properties.name_en || poiFeature.properties.title) : null;
				if (pName && onLocationPicked) {
					onLocationPicked(pName, '', e.lngLat.lat, e.lngLat.lng);
				}
				map.flyTo({
					center: [e.lngLat.lng, e.lngLat.lat],
					essential: true
				});
			}
		});

		fetchAreaPois(centerLat, centerLng);

		return {
			map: map,
			flyTo: function (fLat, fLng, fZoom) {
				map.flyTo({
					center: [fLng, fLat],
					zoom: fZoom || 17.5,
					essential: true
				});
			},
			resize: function () {
				map.resize();
			},
			destroy: function () {
				clearTimeout(debounceTimer);
				renderedPoiMarkers.forEach(function (m) { m.remove(); });
				renderedPoiMarkers.clear();
				map.remove();
			}
		};
	}




	async function openMapSheet(address) {

		var overlay =
			createOverlay(
				'x-map-overlay'
			);


		overlay.innerHTML =
			'<div class="x-sheet-inner x-map-sheet" ' +
				'style="' +
					'max-height:100vh;' +
					'height:100vh;' +
					'width:100%;' +
					'max-width:480px;' +
					'padding:0;' +
					'overflow:hidden;' +
					'border-radius:0;' +
					'position:relative;' +
					'background:#eee;' +
				'">' +

				/* FULLSCREEN MAP CANVAS */
				'<div id="x-address-map-canvas" ' +
					'style="' +
						'position:absolute;' +
						'inset:0;' +
						'width:100%;' +
						'height:100%;' +
						'z-index:1;' +
					'">' +
				'</div>' +

				/* FLOATING SEARCH BAR ON TOP */
				'<div class="x-map-floating-search">' +
					'<div class="x-map-search-bar">' +
						'<img src="' + esc(((window.XentraConfig && window.XentraConfig.pluginUrl) || '/wp-content/plugins/xentra-mvp') + '/assets/icons/red_dot.svg') + '" alt="" style="width:20px;height:20px;object-fit:contain;flex:0 0 20px;">' +
						'<input type="text" id="x-map-search-input" placeholder="Cari alamat" autocomplete="off">' +
						'<button type="button" id="x-map-search-clear" style="display:none;border:0;background:transparent;padding:4px 6px;cursor:pointer;color:#888;font-size:16px;line-height:1;">✕</button>' +
						'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 18px;">' +
							'<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>' +
						'</svg>' +
					'</div>' +
					'<div id="x-map-search-results" class="x-map-search-results" style="display:none;"></div>' +
				'</div>' +

				/* FIXED CENTER POINTER */
				'<div id="x-map-center-pointer" ' +
					'style="' +
						'position:absolute;' +
						'left:50%;' +
						'top:50%;' +
						'width:48px;' +
						'height:60px;' +
						'transform:translate(-50%,-100%);' +
						'z-index:1000;' +
						'pointer-events:none;' +
					'">' +
					'<div style="' +
						'position:absolute;' +
						'left:4px;' +
						'top:0;' +
						'width:40px;' +
						'height:40px;' +
						'border-radius:50% 50% 50% 0;' +
						'background:#ff6a00;' +
						'transform:rotate(-45deg);' +
						'box-shadow:0 2px 6px rgba(0,0,0,.24);' +
					'">' +
						'<span style="' +
							'position:absolute;' +
							'left:12px;' +
							'top:12px;' +
							'width:16px;' +
							'height:16px;' +
							'border-radius:50%;' +
							'background:#fff;' +
						'"></span>' +
					'</div>' +
				'</div>' +

				/* FLOATING BACK BUTTON */
				'<button type="button" class="x-map-back-control" data-map-back="1" aria-label="Kembali" ' +
					'style="' +
						'position:absolute;' +
						'left:18px;' +
						'bottom:calc(220px + env(safe-area-inset-bottom));' +
						'z-index:1001;' +
						'width:48px;' +
						'height:48px;' +
						'padding:0;' +
						'border:0;' +
						'border-radius:50%;' +
						'background:#fff;' +
						'box-shadow:0 3px 12px rgba(0,0,0,.15);' +
						'display:flex;' +
						'align-items:center;' +
						'justify-content:center;' +
						'cursor:pointer;' +
					'">' +
					'<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#222" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
						'<path d="M19 12H5M12 19l-7-7 7-7"/>' +
					'</svg>' +
				'</button>' +

				/* FLOATING GPS LOCATE BUTTON */
				'<button type="button" id="x-map-locate" aria-label="Lokasi saya saat ini" ' +
					'style="' +
						'position:absolute;' +
						'right:18px;' +
						'bottom:calc(220px + env(safe-area-inset-bottom));' +
						'z-index:1001;' +
						'width:48px;' +
						'height:48px;' +
						'padding:0;' +
						'border:0;' +
						'border-radius:50%;' +
						'background:#fff;' +
						'box-shadow:0 3px 12px rgba(0,0,0,.15);' +
						'display:flex;' +
						'align-items:center;' +
						'justify-content:center;' +
						'cursor:pointer;' +
					'">' +
					'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#222" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
						'<circle cx="12" cy="12" r="7"></circle>' +
						'<path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path>' +
						'<circle cx="12" cy="12" r="2.2" fill="#222" stroke="none"></circle>' +
					'</svg>' +
				'</button>' +

				/* BOTTOM SHEET PANEL */
				'<div class="x-map-bottom-panel" ' +
					'style="' +
						'position:absolute;' +
						'left:0;' +
						'right:0;' +
						'bottom:0;' +
						'background:#fff;' +
						'border-radius:24px 24px 0 0;' +
						'z-index:1002;' +
						'padding:12px 18px calc(16px + env(safe-area-inset-bottom));' +
						'box-shadow:0 -6px 24px rgba(0,0,0,.12);' +
						'display:flex;' +
						'flex-direction:column;' +
					'">' +
					'<div class="x-map-handle" style="width:42px;height:4px;flex:0 0 4px;margin:0 auto 12px;border-radius:999px;background:#c8c8c8;"></div>' +
					'<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;">' +
						'<h3 style="margin:0;font-size:18px;line-height:24px;font-weight:700;color:#222;">Pilih lokasi</h3>' +
						'<button type="button" id="x-map-change-location" style="border:0;background:#b6ff00;color:#111;border-radius:20px;height:32px;min-height:32px;padding:0 18px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;">Ubah</button>' +
					'</div>' +
					'<div id="x-map-selected-address" style="display:flex;align-items:flex-start;gap:12px;min-height:0;flex:1 1 auto;overflow:hidden;margin-bottom:12px;">' +
						'<img src="' + esc(((window.XentraConfig && window.XentraConfig.pluginUrl) || '/wp-content/plugins/xentra-mvp') + '/assets/icons/red_dot.svg') + '" alt="" style="width:20px;height:20px;object-fit:contain;flex:0 0 20px;margin-top:2px;">' +
						'<div style="min-width:0;padding-top:1px;">' +
							'<strong id="x-map-selected-title" style="display:block;font-size:16px;line-height:22px;font-weight:700;color:#222;">Lokasi terpilih</strong>' +
							'<div id="x-map-selected-address-text" style="margin-top:3px;font-size:13px;line-height:19px;color:#666;">Memuat alamat...</div>' +
						'</div>' +
					'</div>' +
					'<button type="button" id="x-map-confirm" style="width:100%;height:50px;min-height:50px;border:0;border-radius:25px;background:#b6ff00;color:#111;font-size:15px;font-weight:700;font-family:inherit;cursor:pointer;">Konfirmasi</button>' +
				'</div>' +

			'</div>';


		openDynamicOverlay(overlay);
		bindDynamicOverlayDismiss(overlay, '.x-map-sheet');

		var canvas =
			document.getElementById(
				'x-address-map-canvas'
			);

		var title =
			document.getElementById(
				'x-map-selected-title'
			);

		var addressText =
			document.getElementById(
				'x-map-selected-address-text'
			);

		var confirm =
			document.getElementById(
				'x-map-confirm'
			);

		var locate =
			document.getElementById(
				'x-map-locate'
			);


		var centerLat =
			number(
				address &&
				address.lat
			);

		var centerLng =
			number(
				address &&
				address.lng
			);


		if (!centerLat || !centerLng) {

			var restaurantLat =
				number(
					SETTINGS.maps &&
					SETTINGS.maps.restaurant_lat
				);

			var restaurantLng =
				number(
					SETTINGS.maps &&
					SETTINGS.maps.restaurant_lng
				);

			centerLat =
				restaurantLat || -5.3541;

			centerLng =
				restaurantLng || 104.8138;
		}


		var picked = {
			lat:centerLat,
			lng:centerLng,
			formatted_address:
				address &&
				address.formatted_address
					? address.formatted_address
					: '',
			name:
				address &&
				address.name
					? address.name
					: 'Lokasi terpilih'
		};


		var map =
			null;
		var mapInst =
			null;


		function setConfirmState(enabled) {

			if (!confirm) return;

			confirm.disabled =
				!enabled;

			confirm.style.opacity =
				enabled
					? '1'
					: '.5';
		}


		function renderPicked(
			name,
			formatted
		) {

			picked.name =
				name ||
				'Lokasi terpilih';

			picked.formatted_address =
				formatted ||
				'';

			if (title) {
				title.textContent =
					picked.name;
			}

			if (addressText) {
				addressText.textContent =
					picked.formatted_address ||
					'Mencari alamat...';
			}

			setConfirmState(
				Boolean(
					picked.formatted_address
				)
			);
		}


		/*
		 * FLOATING SEARCH & AUTOCOMPLETE
		 */
		var searchInput = overlay.querySelector('#x-map-search-input');
		var searchClear = overlay.querySelector('#x-map-search-clear');
		var searchResults = overlay.querySelector('#x-map-search-results');
		var searchDebounce = null;

		if (searchInput && searchResults) {
			searchInput.addEventListener('input', function () {
				var query = searchInput.value.trim();
				if (searchClear) searchClear.style.display = query ? 'block' : 'none';

				if (!query || query.length < 2) {
					searchResults.innerHTML = '';
					searchResults.style.display = 'none';
					return;
				}

				clearTimeout(searchDebounce);
				searchDebounce = setTimeout(async function () {
					try {
						var c = map ? map.getCenter() : { lat: picked.lat, lng: picked.lng };
						var url = '/address/search?q=' + encodeURIComponent(query) + '&lat=' + encodeURIComponent(c.lat) + '&lng=' + encodeURIComponent(c.lng);
						var res = await api(url);

						if (Array.isArray(res) && res.length > 0) {
							var html = '';
							res.forEach(function (item) {
								var mainText = item.main_text || item.title || item.name || query;
								var subText = item.secondary_text || item.address || item.description || '';
								html +=
									'<div class="x-map-search-item" data-lat="' + (item.lat || '') + '" data-lng="' + (item.lng || '') + '" data-title="' + esc(mainText) + '" data-address="' + esc(subText) + '">' +
										'<svg class="x-map-search-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
											'<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>' +
											'<circle cx="12" cy="10" r="3"></circle>' +
										'</svg>' +
										'<div style="min-width:0;flex:1;">' +
											'<div class="x-map-search-item-main">' + esc(mainText) + '</div>' +
											(subText ? '<div class="x-map-search-item-sub">' + esc(subText) + '</div>' : '') +
										'</div>' +
									'</div>';
							});

							searchResults.innerHTML = html;
							searchResults.style.display = 'block';

							searchResults.querySelectorAll('.x-map-search-item').forEach(function (el) {
								el.addEventListener('click', function () {
									var itemLat = number(el.getAttribute('data-lat'));
									var itemLng = number(el.getAttribute('data-lng'));
									var itemTitle = el.getAttribute('data-title') || '';
									var itemAddress = el.getAttribute('data-address') || '';

									searchInput.value = itemTitle;
									searchResults.style.display = 'none';

									if (itemLat && itemLng) {
										picked.lat = itemLat;
										picked.lng = itemLng;
										picked.name = itemTitle;
										if (itemAddress) picked.formatted_address = itemAddress;
										renderPicked(itemTitle, itemAddress || picked.formatted_address);

										if (mapInst) {
											mapInst.flyTo(itemLat, itemLng, 17.5);
										}
									}
								});
							});
						} else {
							searchResults.innerHTML = '<div style="padding:12px 16px;font-size:13px;color:#888;text-align:center;">Alamat tidak ditemukan</div>';
							searchResults.style.display = 'block';
						}
					} catch (e) {
						searchResults.style.display = 'none';
					}
				}, 250);
			});

			if (searchClear) {
				searchClear.addEventListener('click', function () {
					searchInput.value = '';
					searchClear.style.display = 'none';
					searchResults.innerHTML = '';
					searchResults.style.display = 'none';
					searchInput.focus();
				});
			}

			overlay.addEventListener('click', function (e) {
				if (!e.target.closest('.x-map-floating-search')) {
					searchResults.style.display = 'none';
				}
			});
		}


		async function locateCustomer() {
			if (!window.XentraLocation || typeof window.XentraLocation.getCurrentPosition !== 'function') return;
			if (locate) {
				locate.disabled = true;
				locate.style.opacity = '.65';
			}
			try {
				var pos = await window.XentraLocation.getCurrentPosition();
				var lat = number(pos && (pos.lat || pos.latitude));
				var lng = number(pos && (pos.lng || pos.longitude));
				if (lat && lng && mapInst) {
					mapInst.flyTo(lat, lng, 17.5);
				}
			} catch (error) {
			} finally {
				if (locate) {
					locate.disabled = false;
					locate.style.opacity = '1';
				}
			}
		}

		var mapChangeLocBtn = overlay.querySelector('#x-map-change-location');
		if (mapChangeLocBtn) {
			mapChangeLocBtn.addEventListener('click', function () {
				closeDynamicOverlay(overlay);
				openAddressPicker();
			});
		}

		var mapBackBtn = overlay.querySelector('[data-map-back]');
		if (mapBackBtn) {
			mapBackBtn.addEventListener('click', function () {
				closeDynamicOverlay(overlay);
				openAddressPicker();
			});
		}

		if (locate) {
			locate.addEventListener('click', locateCustomer);
		}

		confirm.addEventListener('click', function () {
			if (confirm.disabled) return;
			closeDynamicOverlay(overlay);
			openAddressDetailSheet(
				Object.assign(
					{},
					address || {},
					{
						name: picked.name || (address && address.name) || 'Lokasi terpilih',
						formatted_address: picked.formatted_address,
						lat: picked.lat,
						lng: picked.lng
					}
				)
			);
		});

		try {
			await loadMapboxGL();

			mapInst = createXentraInteractiveMap({
				container: canvas,
				centerLng: centerLng,
				centerLat: centerLat,
				zoom: 17.2,
				onLocationPicked: function (pName, pAddr, pLat, pLng) {
					picked.lat = pLat;
					picked.lng = pLng;
					if (pAddr) picked.formatted_address = pAddr;
					renderPicked(pName, pAddr || picked.formatted_address);
				}
			});

			map = mapInst ? mapInst.map : null;

			if (picked.formatted_address) {
				renderPicked(
					picked.name,
					picked.formatted_address
				);
			}

		} catch (error) {
			if (addressText) {
				addressText.textContent = error.message || 'Peta tidak dapat dimuat.';
			}
			setConfirmState(false);
		}
	}

	/* =========================================================
	 * DELIVERY QUOTE
	 * ========================================================= */

	async function updateDeliveryQuote() {

		if (
			state.fulfillment.type !==
			'delivery'
		) {

			state.deliveryFee = 0;
			state.deliveryAvailable =
				true;

			updateSummary();

			return;
		}


		if (
			!state.address ||
			!isFinite(
				number(state.address.lat)
			) ||
			!isFinite(
				number(state.address.lng)
			)
		) {

			state.deliveryFee = 0;
			state.deliveryAvailable =
				false;

			updateSummary();

			return;
		}


		try {

			var quote =
				await api(
					'/delivery/quote?lat=' +
					encodeURIComponent(
						state.address.lat
					) +
					'&lng=' +
					encodeURIComponent(
						state.address.lng
					)
				);


			state.deliveryFee =
				number(
					quote.delivery_fee
				);

			state.deliveryDistanceKm =
				number(
					quote.distance_km
				);

			state.deliveryDurationMinutes =
				number(
					quote.duration_minutes
				);

			state.deliveryAvailable =
				Boolean(
					quote.available
				);


			if (!state.deliveryAvailable) {

				showError(
					'Lokasi berada di luar jangkauan delivery.'
				);

			} else {

				showError('');
			}


			updateSummary();

		} catch (error) {

			state.deliveryFee = 0;
			state.deliveryAvailable =
				false;

			updateSummary();

			showError(
				'Tidak bisa menghitung biaya pengiriman: ' +
				error.message
			);
		}
	}


	/* =========================================================
	 * FULFILLMENT
	 * ========================================================= */

	function availableFulfillments() {

		var types =
			SETTINGS.fulfillment_types || {};

		return Object.keys(types)
			.filter(
				function (key) {
					return Boolean(
						types[key] &&
						types[key].enabled
					);
				}
			);

	}


	var INDO_WEEKDAYS = [
		'Minggu', 'Senin', 'Selasa', 'Rabu',
		'Kamis', 'Jumat', 'Sabtu'
	];

	function isoDateLocal(d) {

		var y = d.getFullYear();

		var m = String(d.getMonth() + 1).padStart(2, '0');

		var day = String(d.getDate()).padStart(2, '0');

		return y + '-' + m + '-' + day;
	}

	function buildScheduleDateList() {

		var list = [];

		var now = new Date();

		for (var i = 0; i < 9; i++) {

			var d = new Date(
				now.getFullYear(),
				now.getMonth(),
				now.getDate() + i
			);

			var label =
				i === 0
					? 'Hari ini'
					: i === 1
						? 'Besok'
						: INDO_WEEKDAYS[d.getDay()];

			list.push({
				iso: isoDateLocal(d),
				label: label
			});
		}

		return list;
	}


	function renderFulfillmentLabel() {

		var label =
			document.getElementById(
				'x-fulfillment-label'
			);


		if (!label) return;


		var type =
			state.fulfillment.type;


		var types =
			SETTINGS.fulfillment_types || {};


		label.textContent =
			(
				types[type] &&
				types[type].label
			) ||
			(
				type === 'dinein'
					? 'Dine-in'
					: type === 'pickup'
						? 'Pick-up'
						: 'Delivery'
			);


		var icon =
			document.getElementById(
				'x-fulfillment-icon'
			);

		if (icon) {

			var iconUrl =
				iconForType(type);

			icon.innerHTML =
				iconUrl
					? '<img src="' +
						esc(iconUrl) +
						'" alt="" aria-hidden="true">'
					: '';
		}

		var scheduleEl =
			document.getElementById(
				'x-fulfillment-schedule'
			);

		if (scheduleEl) {
			if (state.fulfillment.scheduled && state.fulfillment.date && state.fulfillment.slot) {
				var dates = buildScheduleDateList();
				var match = dates.filter(
					function (d) {
						return d.iso === state.fulfillment.date;
					}
				)[0];

				var dateLabel = match ? match.label : state.fulfillment.date;
				scheduleEl.textContent = dateLabel + '  |  ' + state.fulfillment.slot;
				scheduleEl.style.display = 'block';
			} else {
				scheduleEl.textContent = '';
				scheduleEl.style.display = 'none';
			}
		}

	}


	/* =========================================================
	 * PAYMENT METHOD (Tunai / Midtrans)
	 * ========================================================= */

	function availablePaymentMethods() {

		var methods =
			(SETTINGS.payment_methods &&
				SETTINGS.payment_methods.length)
				? SETTINGS.payment_methods.slice()
				: [ 'cash', 'midtrans' ];

		if (methods.indexOf('cash') === -1) {
			methods.unshift('cash');
		}
		if (methods.indexOf('midtrans') === -1) {
			methods.push('midtrans');
		}

		return methods;
	}

	function labelForPaymentMethod(method) {
		return method === 'midtrans' ? 'Pembayaran Online' : 'Tunai';
	}

	function paymentMethodIconUrl(method) {

		var pluginUrl =
			(window.XentraConfig && window.XentraConfig.pluginUrl) || '';

		var base =
			pluginUrl
				? pluginUrl + '/assets/icons/'
				: '/wp-content/plugins/xentra-mvp/assets/icons/';

		var file =
			method === 'midtrans'
				? 'qrisgreen.svg'
				: 'cashgreen.svg';

		return base + file;
	}

	function renderPaymentLabel() {

		var button =
			document.getElementById(
				'x-payment-compact'
			);

		if (!button) return;

		var labelEl =
			document.getElementById('x-payment-compact-label');

		var amountEl =
			document.getElementById('x-payment-compact-amount');

		var iconEl =
			document.getElementById('x-payment-compact-icon');

		var method = state.payment.method;

		if (labelEl) {
			labelEl.textContent = labelForPaymentMethod(method);
		}

		var totalAmount =
			state.cartSubtotal -
			state.promoDiscount +
			(
				state.fulfillment.type === 'delivery' &&
				state.deliveryAvailable &&
				state.address
					? state.deliveryFee
					: 0
			);

		if (amountEl) {
			amountEl.textContent =
				formatThousand(totalAmount);
		}

		if (iconEl) {
			iconEl.innerHTML =
				'<img src="' +
					esc(paymentMethodIconUrl(method)) +
				'" alt="">';
		}

		var moreButton =
			document.getElementById('x-payment-compact-more');

		if (moreButton) {
			moreButton.style.display = 'flex';
		}

		var submitButton =
			document.getElementById('x-submit-order');

		if (submitButton && !submitButton.disabled && !submitButton.dataset.processing) {
			submitButton.textContent =
				state.fulfillment.type === 'delivery'
					? 'Pesan dan antar sekarang'
					: 'Pesan sekarang';
		}
	}

	function openPaymentMethodSheet() {

		closeTopOverlay();

		var methods = availablePaymentMethods();

		var overlay =
			createOverlay('x-payment-overlay');

		function optionRow(method) {

			var active =
				state.payment.method === method;

			var title =
				method === 'midtrans'
					? 'Pembayaran online'
					: 'Tunai (COD)';

			var subtitle =
				method === 'midtrans'
					? 'QRIS, transfer bank, e-wallet, dll via Midtrans'
					: 'Bayar ke kurir saat pesanan tiba';

			return (
				'<button type="button" class="x-payment-option' +
					(active ? ' active' : '') +
					'" data-payment-method="' + esc(method) + '">' +

					'<span class="x-payment-option-icon">' +
						'<img src="' + esc(paymentMethodIconUrl(method)) + '" alt="">' +
					'</span>' +

					'<span class="x-payment-option-text">' +
						'<strong>' + esc(title) + '</strong>' +
						'<small>' + esc(subtitle) + '</small>' +
					'</span>' +

					'<span class="x-payment-option-check' +
						(active ? ' active' : '') +
						'" aria-hidden="true"></span>' +

				'</button>'
			);
		}

		var pluginUrl =
			(window.XentraConfig && window.XentraConfig.pluginUrl) || '';

		var midtransLogoUrl =
			pluginUrl
				? pluginUrl + '/assets/icons/midtrans.svg'
				: '/wp-content/plugins/xentra-mvp/assets/icons/midtrans.svg';

		overlay.innerHTML =
			'<div class="x-sheet-inner x-payment-sheet">' +

				'<div class="x-sheet-handle"></div>' +

				'<div class="x-payment-title" style="font-size:18px;line-height:24px;font-weight:700;color:#222;margin:4px 0 16px;">Metode pembayaran</div>' +

				'<div class="x-payment-options">' +
					methods.map(optionRow).join('') +
				'</div>' +

				'<div class="x-payment-footer" style="margin-top:24px;padding-bottom:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:4px;width:100%;">' +
					'<div style="font-size:12px;line-height:17px;color:#777;font-weight:500;text-align:center;">🔒 Transaksi aman dan terenkripsi</div>' +
					'<div style="font-size:13px;line-height:18px;color:#555;font-weight:600;display:flex;align-items:center;justify-content:center;gap:6px;text-align:center;">' +
						'<span>Diproses oleh</span>' +
						'<img src="' + esc(midtransLogoUrl) + '" alt="midtrans" style="height:12px;width:auto;object-fit:contain;display:inline-block;vertical-align:middle;">' +
					'</div>' +
				'</div>' +

			'</div>';

		openDynamicOverlay(overlay);
		bindDynamicOverlayDismiss(overlay, '.x-payment-sheet');

		overlay.querySelectorAll('[data-payment-method]').forEach(
			function (button) {

				button.addEventListener('click', function () {

					var method = button.getAttribute('data-payment-method');

					state.payment.method = method;

					/*
					 * Switching payment method invalidates any pending
					 * Midtrans retry token from a previous attempt.
					 */
					state.payment.snapToken = null;
					state.payment.redirectUrl = null;

					renderPaymentLabel();

					overlay.querySelectorAll('[data-payment-method]').forEach(
						function (other) {

							var isActive = other === button;

							other.classList.toggle('active', isActive);

							var check =
								other.querySelector('.x-payment-option-check');

							if (check) {
								check.classList.toggle('active', isActive);
							}
						}
					);

					setTimeout(function () {
						closeDynamicOverlay(overlay);
					}, 250);
				});
			}
		);
	}


	/* =========================================================
	 * MIDTRANS SNAP
	 *
	 * Snap opens as a layer inside the existing Checkout state
	 * (an in-page popup/iframe), never a page navigation - see the
	 * state/overlay architecture decision, section 9.
	 * ========================================================= */

	var midtransSnapLoading = null;

	function loadMidtransSnap() {

		if (window.snap) {
			return Promise.resolve(window.snap);
		}

		if (midtransSnapLoading) {
			return midtransSnapLoading;
		}

		midtransSnapLoading = new Promise(function (resolve, reject) {

			var config = SETTINGS.midtrans || {};

			if (!config.enabled || !config.client_key || !config.snap_url) {
				reject(new Error('Midtrans belum dikonfigurasi.'));
				return;
			}

			var script = document.createElement('script');

			script.src = config.snap_url;
			script.setAttribute('data-client-key', config.client_key);

			script.onload = function () {

				if (window.snap) {
					resolve(window.snap);
				} else {
					reject(new Error('Midtrans tidak dapat dimuat.'));
				}
			};

			script.onerror = function () {
				reject(new Error('Midtrans tidak dapat dimuat.'));
			};

			document.head.appendChild(script);
		});

		return midtransSnapLoading;
	}

	function resetSubmitButtonForRetry() {

		var button =
			document.getElementById('x-submit-order');

		if (!button) return;

		button.disabled = false;

		button.textContent =
			state.payment.snapToken
				? 'Bayar sekarang'
				: 'Pesan sekarang';
	}

	async function openMidtransPayment(token, redirectUrl) {

		try {

			var snap = await loadMidtransSnap();

			snap.pay(token, {

				onSuccess: function () {
					clearCheckedOutItems();
					window.location.href = redirectUrl;
				},

				onPending: function () {
					clearCheckedOutItems();
					window.location.href = redirectUrl;
				},

				onError: function () {
					showError('Pembayaran gagal. Coba lagi.');
					resetSubmitButtonForRetry();
				},

				onClose: function () {
					showError(
						'Pembayaran belum selesai. Pesananmu masih tersimpan, ' +
						'tekan tombol untuk bayar lagi.'
					);
					resetSubmitButtonForRetry();
				}
			});

		} catch (error) {

			showError(
				error.message ||
				'Midtrans tidak dapat dimuat.'
			);

			resetSubmitButtonForRetry();
		}
	}


	function openFulfillmentSheet() {

		closeTopOverlay();

		var types =
		availableFulfillments();

	var original = {
		type: state.fulfillment.type,
		scheduled: state.fulfillment.scheduled,
		date: state.fulfillment.date,
		slot: state.fulfillment.slot,
		party_size: state.fulfillment.party_size
	};

	var draft = {
		type: state.fulfillment.type || 'delivery',
		scheduled: Boolean(state.fulfillment.scheduled),
		date: state.fulfillment.date || '',
		slot: state.fulfillment.slot || '',
		party_size: state.fulfillment.party_size || ''
	};

	var overlay =
		createOverlay(
			'x-fulfillment-overlay'
		);

	function labelForType(type) {

		var config =
			SETTINGS.fulfillment_types &&
			SETTINGS.fulfillment_types[type];

		return (
			config &&
			config.label
		) ||
		(
			type === 'pickup'
				? 'Pick-up'
				: type === 'dinein'
					? 'Dine-in'
					: 'Delivery'
		);
	}

	function iconForType(type) {

	var pluginUrl =
		(
			window.XentraConfig &&
			window.XentraConfig.pluginUrl
		) || '';

	var icons = {
		delivery: 'delivery.png',
		pickup: 'pick_up.png',
		dinein: 'dine_in.png'
	};

	if (!icons[type]) {
		return '';
	}

	return pluginUrl
		? pluginUrl + '/assets/icons/' + icons[type]
		: '/wp-content/plugins/xentra-mvp/assets/icons/' + icons[type];
}
        
        
	function render() {

		var html =
			'<div class="x-sheet-inner x-fulfillment-sheet">' +

				'<div class="x-sheet-handle"></div>' +

				'<div class="x-fulfillment-title">' +
					'Pilih tipe pembelian' +
				'</div>' +

				'<div class="x-fulfillment-types">';

		[
			'delivery',
			'pickup',
			'dinein'
		].forEach(
			function (type) {

				if (
					types.indexOf(type) === -1 &&
					type !== 'dinein'
				) {
					return;
				}

				var enabled =
					types.indexOf(type) !== -1;

				var active =
					draft.type === type;

				html +=
					'<button type="button" ' +
					'class="x-fulfillment-type ' +
					(active ? 'active ' : '') +
					(!enabled ? 'disabled' : '') +
					'" data-type="' +
					esc(type) +
					'" ' +
					(!enabled ? 'disabled' : '') +
					'>' +

						(
							iconForType(type)
								? '<img src="' +
									esc(iconForType(type)) +
									'" alt="">'
								: '<span class="x-fulfillment-type-icon"></span>'
						) +

						'<span>' +
							esc(
								labelForType(type)
							) +
						'</span>' +

						(
							type === 'dinein' && !enabled
								? '<small>Unavailable</small>'
								: ''
						) +

					'</button>';

			}
		);

		html +=
			'</div>' +

			'<div class="x-fulfillment-divider"></div>' +

			'<div class="x-fulfillment-schedule-head">' +

				'<span>' +
					(
						draft.type === 'delivery'
							? 'Jadwalkan pengantaran'
							: 'Jadwalkan pembelian'
					) +
				'</span>' +

				'<button type="button" ' +
					'class="x-fulfillment-toggle ' +
					(draft.scheduled ? 'on' : '') +
					'" ' +
					'id="x-fulfillment-schedule-toggle" ' +
					'aria-pressed="' +
					(draft.scheduled ? 'true' : 'false') +
					'">' +

					'<span></span>' +

				'</button>' +

			'</div>';

		if (draft.scheduled) {

			html +=
				'<div class="x-fulfillment-schedule-picker" ' +
					'id="x-fulfillment-picker">' +

					'<div class="x-fulfillment-picker-row">' +

						'<div class="x-wheel-highlight"></div>' +
						'<div class="x-wheel-divider"></div>' +

						'<div class="x-wheel-col" ' +
							'id="x-wheel-date-col"></div>' +

						'<div class="x-wheel-col" ' +
							'id="x-wheel-time-col">' +

							'<div class="x-sheet-schedule-loading">' +
								'Memuat jadwal...' +
							'</div>' +

						'</div>' +

					'</div>' +

				'</div>' +

				'<div class="x-fulfillment-selected-summary">' +

					'<span>Pembelianmu bakal sampai pada</span>' +

					'<strong id="x-fulfillment-selected-summary">' +
						(
							draft.slot
								? draft.slot
								: 'Pilih jadwal'
						) +
					'</strong>' +

				'</div>';

		}

		html +=
			'<div class="x-fulfillment-promo">' +

				'<span>●</span>' +

				'<span>' +
					'Ketersediaan promo tergantung pada tipe pembelian' +
				'</span>' +

			'</div>' +

			'<div class="x-fulfillment-actions">' +

				'<button type="button" ' +
					'class="x-fulfillment-cancel" ' +
					'data-close="1">' +
					'Gak jadi' +
				'</button>' +

				'<button type="button" ' +
					'class="x-fulfillment-confirm" ' +
					'id="x-fulfillment-confirm">' +
					'Konfirmasi' +
				'</button>' +

			'</div>' +

		'</div>';

		overlay.innerHTML = html;

		bind();
	}

	var scheduleDatesCache = [];

	var WHEEL_ITEM_HEIGHT = 44;

	/*
	 * Generic iPhone-style scroll wheel: a snap-scrolling single
	 * column of items with a fixed selection band. Rendered straight
	 * into `container` (which becomes the scroll element itself), so
	 * a fresh set of items just means clearing and rebuilding it -
	 * no separate teardown needed.
	 */
	function buildWheelInto(container, items, selectedValue, onSettle) {

		container.innerHTML = '';

		if (!items.length) {
			return;
		}

		var padTop = document.createElement('div');
		padTop.className = 'x-wheel-pad';
		padTop.style.height = WHEEL_ITEM_HEIGHT + 'px';
		container.appendChild(padTop);

		var itemEls = items.map(
			function (item) {

				var el = document.createElement('div');

				el.className = 'x-wheel-item';
				el.style.height = WHEEL_ITEM_HEIGHT + 'px';
				el.textContent = item.label;

				container.appendChild(el);

				return el;
			}
		);

		var padBottom = document.createElement('div');
		padBottom.className = 'x-wheel-pad';
		padBottom.style.height = WHEEL_ITEM_HEIGHT + 'px';
		container.appendChild(padBottom);

		var currentIndex = 0;

		items.forEach(
			function (item, index) {
				if (item.value === selectedValue) {
					currentIndex = index;
				}
			}
		);

		var settleTimer = null;

		function applyVisualState(raw) {

			itemEls.forEach(
				function (el, i) {

					var dist = Math.abs(i - raw);

					el.classList.toggle(
						'active',
						dist < 0.5
					);

					el.style.opacity =
						dist < 0.5
							? '1'
							: dist < 1.5
								? '0.45'
								: '0.22';

					el.style.transform =
						'scale(' +
						(dist < 0.5 ? 1 : 0.92) +
						')';
				}
			);
		}

		function scrollToIndex(index, smooth) {

			container.scrollTo({
				top: index * WHEEL_ITEM_HEIGHT,
				behavior: smooth === false ? 'auto' : 'smooth'
			});
		}

		function commit(index) {

			currentIndex = index;

			applyVisualState(index);

			if (typeof onSettle === 'function') {
				onSettle(items[index], index);
			}
		}

		container.addEventListener(
			'scroll',
			function () {

				var raw =
					container.scrollTop /
					WHEEL_ITEM_HEIGHT;

				applyVisualState(raw);

				window.clearTimeout(settleTimer);

				settleTimer = window.setTimeout(
					function () {

						var index =
							Math.max(
								0,
								Math.min(
									items.length - 1,
									Math.round(raw)
								)
							);

						if (
							Math.abs(
								container.scrollTop -
								index * WHEEL_ITEM_HEIGHT
							) > 1
						) {
							scrollToIndex(index);
						}

						commit(index);
					},
					110
				);
			},
			{ passive: true }
		);

		itemEls.forEach(
			function (el, index) {

				el.addEventListener(
					'click',
					function () {

						scrollToIndex(index);

						window.clearTimeout(settleTimer);

						settleTimer = window.setTimeout(
							function () {
								commit(index);
							},
							260
						);
					}
				);
			}
		);

		window.requestAnimationFrame(
			function () {
				scrollToIndex(currentIndex, false);
				applyVisualState(currentIndex);
			}
		);
	}

	function updateSelectedSummary() {

		var summary =
			document.getElementById(
				'x-fulfillment-selected-summary'
			);

		if (!summary) {
			return;
		}

		if (draft.date && draft.slot) {

			var match =
				scheduleDatesCache.filter(
					function (d) {
						return d.iso === draft.date;
					}
				)[0];

			summary.textContent =
				(match ? match.label : draft.date) +
				' | ' +
				draft.slot;

		} else {

			summary.textContent = 'Pilih jadwal';
		}
	}

	function loadTimeWheel(date) {

		var timeCol =
			document.getElementById(
				'x-wheel-time-col'
			);

		if (!timeCol) {
			return;
		}

		timeCol.innerHTML =
			'<div class="x-sheet-schedule-loading">' +
				'Memuat jadwal...' +
			'</div>';

		api(
			'/fulfillment/slots?type=' +
			encodeURIComponent(draft.type) +
			'&date=' +
			encodeURIComponent(date || '')
		)
		.then(
			function (result) {

				var slots =
					result &&
					Array.isArray(result.slots)
						? result.slots
						: [];

				if (!slots.length) {

					timeCol.innerHTML =
						'<div class="x-sheet-schedule-empty">' +
							'Belum ada jadwal tersedia.' +
						'</div>';

					draft.slot = '';

					updateSelectedSummary();

					return;
				}

				var selectedSlot =
					slots.some(
						function (s) {
							return s.label === draft.slot;
						}
					)
						? draft.slot
						: slots[0].label;

				draft.date = result.date || date;
				draft.slot = selectedSlot;

				buildWheelInto(
					timeCol,
					slots.map(
						function (s) {
							return {
								value: s.label,
								label: s.label
							};
						}
					),
					selectedSlot,
					function (item) {
						draft.slot = item.value;
						updateSelectedSummary();
					}
				);

				updateSelectedSummary();
			}
		)
		.catch(
			function () {

				timeCol.innerHTML =
					'<div class="x-sheet-schedule-empty">' +
						'Jadwal tidak dapat dimuat.' +
					'</div>';
			}
		);
	}

	function initSchedulePicker() {

		var dateCol =
			document.getElementById(
				'x-wheel-date-col'
			);

		if (!dateCol) {
			return;
		}

		var dates = buildScheduleDateList();

		scheduleDatesCache = dates;

		var initialDate =
			draft.date &&
			dates.some(
				function (d) {
					return d.iso === draft.date;
				}
			)
				? draft.date
				: dates[0].iso;

		draft.date = initialDate;

		buildWheelInto(
			dateCol,
			dates.map(
				function (d) {
					return {
						value: d.iso,
						label: d.label
					};
				}
			),
			initialDate,
			function (item) {
				draft.date = item.value;
				draft.slot = '';
				updateSelectedSummary();
				loadTimeWheel(item.value);
			}
		);

		loadTimeWheel(initialDate);
	}

	function bind() {

		var toggle =
			document.getElementById(
				'x-fulfillment-schedule-toggle'
			);

		if (toggle) {

			toggle.addEventListener(
				'click',
				function () {

					draft.scheduled =
						!draft.scheduled;

					if (!draft.scheduled) {

						draft.date = '';
						draft.slot = '';

					}

					render();

					if (draft.scheduled) {

						initSchedulePicker();
					}
				}
			);
		}

		overlay
			.querySelectorAll(
				'.x-fulfillment-type:not(.disabled)'
			)
			.forEach(
				function (button) {

					button.addEventListener(
						'click',
						function () {

							draft.type =
								button.dataset.type;

							draft.scheduled =
								false;

							draft.date = '';
							draft.slot = '';

							render();

						}
					);

				}
			);

		var cancel =
			overlay.querySelector('.x-fulfillment-cancel');

		if (cancel) {
			cancel.addEventListener('click', function () {
				closeDynamicOverlay(overlay);
			});
		}

		var confirm =
			overlay.querySelector('.x-fulfillment-confirm') ||
			overlay.querySelector('#x-fulfillment-confirm') ||
			document.getElementById('x-fulfillment-confirm');

		if (confirm) {

			confirm.addEventListener(
				'click',
				function () {

					state.fulfillment.type =
						draft.type;

					state.fulfillment.scheduled =
						Boolean(
							draft.scheduled
						);

					state.fulfillment.date =
						draft.date || '';

					state.fulfillment.slot =
						draft.slot || '';

					state.fulfillment.party_size =
						draft.party_size || '';

					renderFulfillmentLabel();

					updateSummary();

					loadScheduleForCurrentType();

					closeDynamicOverlay(overlay);

				}
			);
		}
	}

	openDynamicOverlay(overlay);

	render();

	bindDynamicOverlayDismiss(overlay, '.x-fulfillment-sheet');

	if (draft.scheduled) {

		initSchedulePicker();
	}
}
    
    

	function loadScheduleForCurrentType() {

		if (
			typeof window.xentraLoadFulfillmentSchedule !==
			'function'
		) {
			return;
		}


		window.xentraLoadFulfillmentSchedule(
			api,
			state.fulfillment.type
		);

	}


	function setupScheduleSlots() {

		var container =
			document.getElementById(
				'x-fulfillment-slots'
			);


		if (!container) return;


		container.addEventListener(
			'click',
			function (event) {

				var slot =
					event.target.closest(
						'.x-slot'
					);


				if (
					!slot ||
					slot.disabled
				) {
					return;
				}


				state.fulfillment.scheduled =
					true;

				state.fulfillment.date =
					slot.dataset.date ||
					'';

				state.fulfillment.slot =
					slot.dataset.slot ||
					slot.textContent.trim();


				container
					.querySelectorAll(
						'.x-slot'
					)
					.forEach(
						function (button) {

							button.classList.remove(
								'active'
							);

						}
					);


				slot.classList.add(
					'active'
				);

			}
		);

	}


	/* =========================================================
	 * GUEST-FIRST WHATSAPP OTP
	 *
	 * Locked MVP contract:
	 * - Guest-first, passwordless checkout.
	 * - OTP only at the order action when phone + device is untrusted.
	 * - Successful OTP creates 30-day server-side trust.
	 * - OTP is verification, not login/account/session state.
	 * ========================================================= */

	function openAuthSheet(className, innerHtml) {

		var overlay = createOverlay(className);

		overlay.innerHTML =
			'<div class="x-sheet-inner x-auth-sheet">' +
				'<div class="x-sheet-handle"></div>' +
				innerHtml +
			'</div>';

		/*
		 * Deliberately no tap-outside/swipe-to-close here: dismissing
		 * mid-OTP-verification by an accidental tap would lose the
		 * in-flight code. "Ganti nomor WhatsApp" is the intentional
		 * exit. Back/hardware-back/gesture still closes it (with the
		 * same animation as every other sheet) via __xentraClose,
		 * wired by openDynamicOverlay().
		 */
		openDynamicOverlay(overlay);

		return overlay;
	}


	function openOtpSheet(phone, challengeId, onVerified, cooldownSeconds) {

		var overlay = openAuthSheet(
			'x-auth-overlay',
			'<h3>Verifikasi nomor WhatsApp</h3>' +
			'<p class="x-auth-subtitle">Kami mengirim kode verifikasi ke ' + esc(maskPhone(phone)) + '.</p>' +
			'<input type="text" inputmode="numeric" autocomplete="one-time-code" id="x-auth-otp" maxlength="6" placeholder="Kode OTP" aria-label="Kode OTP">' +
			'<div class="x-auth-error" id="x-auth-error" style="display:none;"></div>' +
			'<button type="button" class="x-auth-primary" id="x-auth-verify">Verifikasi</button>' +
			'<button type="button" class="x-auth-link" id="x-auth-resend">Kirim ulang kode</button>' +
			'<button type="button" class="x-auth-link x-auth-edit" id="x-auth-edit-phone">Ganti nomor WhatsApp</button>'
		);

		var input = overlay.querySelector('#x-auth-otp');
		var errorBox = overlay.querySelector('#x-auth-error');
		var verifyButton = overlay.querySelector('#x-auth-verify');
		var resendButton = overlay.querySelector('#x-auth-resend');
		var editButton = overlay.querySelector('#x-auth-edit-phone');
		var timer = null;

		function showAuthError(message) {
			errorBox.style.display = 'block';
			errorBox.textContent = message || '';
		}

		function runCooldown(seconds) {
			var remaining = Math.max(0, Number(seconds || 0));
			if (timer) window.clearInterval(timer);

			function tick() {
				if (remaining <= 0) {
					resendButton.disabled = false;
					resendButton.textContent = 'Kirim ulang kode';
					if (timer) window.clearInterval(timer);
					return;
				}
				resendButton.disabled = true;
				resendButton.textContent = 'Kirim ulang (' + remaining + ' detik)';
				remaining -= 1;
			}

			tick();
			timer = window.setInterval(tick, 1000);
		}

		setTimeout(function () { input.focus(); }, 150);
		runCooldown(cooldownSeconds || 60);

		async function verify() {
			var code = input.value.replace(/[^0-9]/g, '').slice(0, 6);
			input.value = code;
			if (code.length !== 6) {
				showAuthError('Masukkan kode OTP 6 digit.');
				return;
			}

			verifyButton.disabled = true;
			verifyButton.textContent = 'Memverifikasi...';

			try {
				var result = await api('/auth/otp/verify', {
					method: 'POST',
					body: JSON.stringify({
						phone: phone,
						challenge_id: challengeId,
						code: code,
						device_id: DEVICE_ID
					})
				});

				if (!result.success) {
					showAuthError(result.message || 'Kode OTP salah.');
					return;
				}

				closeDynamicOverlay(overlay);
				if (timer) window.clearInterval(timer);
				if (typeof onVerified === 'function') onVerified();
			} catch (error) {
				showAuthError(error.message || 'Verifikasi tidak dapat diproses.');
			} finally {
				verifyButton.disabled = false;
				verifyButton.textContent = 'Verifikasi';
			}
		}

		async function resend() {
			resendButton.disabled = true;
			try {
				var result = await api('/auth/otp/send', {
					method: 'POST',
					body: JSON.stringify({
						phone: phone,
						device_id: DEVICE_ID,
						checkout_token: TOKEN
					})
				});

				if (!result.success) {
					showAuthError(result.message || 'Kode OTP tidak dapat dikirim.');
					runCooldown(result.retry_after || 0);
					return;
				}

				challengeId = result.challenge_id;
				errorBox.style.display = 'block';
				errorBox.textContent = 'Kode verifikasi sudah dikirim ke WhatsApp kamu.';
				runCooldown(result.retry_after || 60);
			} catch (error) {
				showAuthError(error.message || 'Kode OTP tidak dapat dikirim.');
				resendButton.disabled = false;
			}
		}

		verifyButton.addEventListener('click', verify);
		input.addEventListener('input', function () {
			this.value = this.value.replace(/[^0-9]/g, '').slice(0, 6);
		});
		input.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') verify();
		});
		resendButton.addEventListener('click', resend);
		editButton.addEventListener('click', function () {
			if (timer) window.clearInterval(timer);
			closeDynamicOverlay(overlay);
			openCustomerVerificationSheet(onVerified);
		});
	}


	function openCustomerVerificationSheet(onSuccess) {
		var customer = getCustomerData();
		var overlay = openAuthSheet(
			'x-customer-auth-overlay',
			'<h3>Data pemesan</h3>' +
			'<p class="x-auth-subtitle">Isi nama dan nomor WhatsApp aktif untuk verifikasi pesanan kamu.</p>' +
			'<div class="x-auth-field">' +
				'<label class="x-auth-label" for="x-auth-customer-name">Nama lengkap</label>' +
				'<input type="text" id="x-auth-customer-name" class="x-auth-input" placeholder="Contoh: Budi Santoso" autocomplete="name" maxlength="120" value="' + esc(customer.name || '') + '">' +
			'</div>' +
			'<div class="x-auth-field">' +
				'<label class="x-auth-label" for="x-auth-customer-phone">Nomor WhatsApp</label>' +
				'<input type="tel" id="x-auth-customer-phone" class="x-auth-input" placeholder="08xxxxxxxxxx" inputmode="numeric" autocomplete="tel" maxlength="20" value="' + esc(customer.phone || '') + '">' +
			'</div>' +
			'<div class="x-auth-error" id="x-auth-customer-error" style="display:none;"></div>' +
			'<button type="button" class="x-auth-primary" id="x-auth-customer-submit">Lanjut Verifikasi OTP</button>'
		);

		var nameInput = overlay.querySelector('#x-auth-customer-name');
		var phoneInput = overlay.querySelector('#x-auth-customer-phone');
		var errorBox = overlay.querySelector('#x-auth-customer-error');
		var submitBtn = overlay.querySelector('#x-auth-customer-submit');

		function showAuthErr(msg) {
			errorBox.style.display = 'block';
			errorBox.textContent = msg || '';
		}

		setTimeout(function () {
			if (!nameInput.value.trim()) {
				nameInput.focus();
			} else {
				phoneInput.focus();
			}
		}, 150);

		async function submitCustomerInfo() {
			var name = nameInput.value.trim();
			var rawPhone = phoneInput.value.trim();
			var digits = normalizePhoneForClient(rawPhone);

			if (!name || name.length < 2) {
				showAuthErr('Nama lengkap wajib diisi (minimal 2 karakter).');
				nameInput.focus();
				return;
			}

			if (digits.length < 9) {
				showAuthErr('Masukkan nomor WhatsApp yang valid (minimal 9 digit).');
				phoneInput.focus();
				return;
			}

			setCustomerData(name, rawPhone);

			submitBtn.disabled = true;
			submitBtn.textContent = 'Memproses...';

			try {
				closeDynamicOverlay(overlay);
				await beginOtpForOrder(rawPhone, onSuccess);
			} catch (err) {
				showAuthErr(err.message || 'Gagal memulai verifikasi.');
				submitBtn.disabled = false;
				submitBtn.textContent = 'Lanjut Verifikasi OTP';
			}
		}

		submitBtn.addEventListener('click', submitCustomerInfo);
		phoneInput.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') submitCustomerInfo();
		});
		nameInput.addEventListener('keydown', function (e) {
			if (e.key === 'Enter') phoneInput.focus();
		});
	}


	async function beginOtpForOrder(phone, onVerified) {
		try {
			var trust = await api('/auth/otp/trust', {
				method: 'POST',
				body: JSON.stringify({
					phone: phone,
					device_id: DEVICE_ID
				})
			});

			if (trust.success && trust.trusted) {
				if (typeof onVerified === 'function') onVerified();
				return;
			}

			var sent = await api('/auth/otp/send', {
				method: 'POST',
				body: JSON.stringify({
					phone: phone,
					device_id: DEVICE_ID,
					checkout_token: TOKEN
				})
			});

			if (!sent.success) {
				throw new Error(sent.message || 'Kode verifikasi tidak dapat dikirim.');
			}

			openOtpSheet(phone, sent.challenge_id, onVerified, sent.retry_after || 60);
		} catch (error) {
			showError(error.message || 'Verifikasi nomor WhatsApp tidak dapat dimulai.');
			var submit = document.getElementById('x-submit-order');
			if (submit) setSubmitAvailability();
		}
	}


	/* =========================================================
	 * SUBMIT
	 * ========================================================= */

	function setSubmitAvailability() {

		var button =
			document.getElementById(
				'x-submit-order'
			);


		if (!button) return;


		var items = getSessionItems();
		var enabled =
			SETTINGS.store_open !== false &&
			items.length > 0;

		button.disabled =
			!enabled;
	}


	async function submitOrder() {

		/*
		 * Retry path: an order + Midtrans Snap token already exist
		 * from a previous attempt (customer closed the popup without
		 * paying). Re-open the same transaction instead of
		 * re-submitting the order, which would create a duplicate.
		 */
		if (state.payment.snapToken) {
			openMidtransPayment(
				state.payment.snapToken,
				state.payment.redirectUrl
			);
			return;
		}

		var button =
			document.getElementById(
				'x-submit-order'
			);


		if (!button) return;


		var items = getSessionItems();
		if (!items.length) {
			showError('Keranjang Anda kosong.');
			return;
		}

		if (
			state.fulfillment.type === 'delivery' &&
			(!state.address || !state.address.formatted_address)
		) {
			showError('Isi alamat terlebih dahulu.');
			var trigger = document.getElementById('x-address-detail-trigger');
			if (trigger) trigger.click();
			return;
		}


		setSubmitAvailability();


		if (button.disabled) {

			if (
				state.fulfillment.type === 'delivery' &&
				(!state.address || !state.address.formatted_address)
			) {
				showError('Isi alamat terlebih dahulu.');
				var trigger = document.getElementById('x-address-detail-trigger');
				if (trigger) trigger.click();
			} else {
				showError('Pesanan belum siap dikirim.');
			}

			return;
		}


		var customerData = getCustomerData();
		var phoneDigits = normalizePhoneForClient(customerData.phone);

		if (!customerData.name || phoneDigits.length < 9) {
			openCustomerVerificationSheet(function () {
				finalizeSubmit();
			});
			return;
		}

		button.disabled = true;
		beginOtpForOrder(customerData.phone, function () {
			finalizeSubmit();
		});
	}


	function clearCheckedOutItems() {
		try {
			var orderedIds = (SESSION && Array.isArray(SESSION.items))
				? SESSION.items.map(function (i) { return number(i.id); })
				: [];

			var raw = localStorage.getItem('xentra_mvp_v4_cart');
			var fullCart = null;
			if (raw) {
				try {
					var parsed = JSON.parse(raw);
					fullCart = (parsed && parsed.data) ? parsed.data : parsed;
				} catch (e) {}
			}

			if (fullCart && Array.isArray(fullCart.items)) {
				var remainingItems = fullCart.items.filter(function (item) {
					return !orderedIds.includes(number(item.id));
				});

				localStorage.setItem('xentra_mvp_v4_cart', JSON.stringify({
					savedAt: Date.now(),
					expires: Date.now() + (30 * 24 * 60 * 60 * 1000),
					data: { items: remainingItems }
				}));
			} else {
				localStorage.setItem('xentra_mvp_v4_cart', JSON.stringify({
					savedAt: Date.now(),
					expires: Date.now() + (30 * 24 * 60 * 60 * 1000),
					data: { items: [] }
				}));
			}

			var rawNotes = localStorage.getItem('xentra_mvp_v4_notes');
			if (rawNotes) {
				try {
					var parsedNotes = JSON.parse(rawNotes);
					var notesObj = (parsedNotes && parsedNotes.data) ? parsedNotes.data : parsedNotes;
					if (notesObj && typeof notesObj === 'object') {
						orderedIds.forEach(function (id) {
							delete notesObj[id];
						});
						localStorage.setItem('xentra_mvp_v4_notes', JSON.stringify({
							savedAt: Date.now(),
							expires: Date.now() + (30 * 24 * 60 * 60 * 1000),
							data: notesObj
						}));
					}
				} catch (e) {}
			}

			localStorage.removeItem(CHECKOUT_DRAFT_KEY);
			localStorage.removeItem(NOTE_STORAGE_KEY);
		} catch (err) {}
	}

	async function finalizeSubmit() {

		var button =
			document.getElementById(
				'x-submit-order'
			);

		if (!button) return;


		var customer = getCustomerData();


		var payload = {

			token: TOKEN,

			device_id: DEVICE_ID,

			customer: {
				name: customer.name || '',
				phone: customer.phone || ''
			},

			address:
				state.address || {},

			fulfillment:
				{
					type:
						state.fulfillment.type,

					scheduled:
						Boolean(
							state.fulfillment
								.scheduled
						),

					date:
						state.fulfillment
							.date || '',

					slot:
						state.fulfillment
							.slot || '',

					party_size:
						state.fulfillment
							.party_size || ''
				},

			payment_method:
				state.payment.method || 'cash',

			note:
				state.orderNote || ''
		};


		button.disabled = true;
		button.textContent =
			'Memproses...';


		try {

			var result =
				await api(
					'/checkout/submit',
					{
						method: 'POST',
						body:
							JSON.stringify(
								payload
							)
					}
				);


			if (
				result.success &&
				result.payment &&
				result.payment.method === 'midtrans' &&
				result.payment.snap_token
			) {

				clearCheckedOutItems();

				state.payment.snapToken =
					result.payment.snap_token;

				state.payment.redirectUrl =
					result.redirect_url ||
					result.payment.redirect_url;

				openMidtransPayment(
					state.payment.snapToken,
					state.payment.redirectUrl
				);

				return;
			}


			if (
				result.success &&
				result.redirect_url
			) {

				clearCheckedOutItems();

				window.location.href =
					result.redirect_url;

				return;
			}


			if (
				result.errors &&
				result.errors.length
			) {

				throw new Error(
					result.errors
						.map(
							function (item) {
								return item.message;
							}
						)
						.join('\n')
				);
			}


			throw new Error(
				result.message ||
				'Pesanan tidak dapat dibuat.'
			);

		} catch (error) {

			showError(
				error.message
			);

			button.disabled = false;
			button.textContent =
				'Pesan sekarang';

		}

	}



	/*
	 * ADDRESS ACTIONS — delegated binding
	 *
	 * These controls are rendered dynamically by updateAddressBlock().
	 * Bind once at document level so re-renders cannot detach the actions.
	 */
	if (
		!window.__XENTRA_ADDRESS_ACTIONS_BOUND
	) {

		window.__XENTRA_ADDRESS_ACTIONS_BOUND = true;

		document.addEventListener(
			'click',
			function (event) {

				var target =
					event.target &&
					event.target.closest
						? event.target.closest(
							'#x-address-change'
						)
						: null;

				if ( target ) {

					event.preventDefault();
					event.stopPropagation();

					openAddressPicker();

					return;
				}


				target =
					event.target &&
					event.target.closest
						? event.target.closest(
							'#x-address-detail-trigger'
						)
						: null;

				if ( target ) {

					event.preventDefault();
					event.stopPropagation();

					openAddressDetailSheet(
						state.address || {}
					);

					return;
				}
			},
			true
		);
	}

	

/* =========================================================
	 * INIT
	 * ========================================================= */

	var xentraCheckoutMounted = false;


	function init() {

		if (
			!document.getElementById(
				'xentra-checkout-app'
			)
		) {
			return;
		}

		if (
			xentraCheckoutMounted
		) {
			return;
		}

		xentraCheckoutMounted = true;

		var checkoutAppRoot =
			document.getElementById(
				'xentra-checkout-app'
			);

		if ( checkoutAppRoot ) {
			checkoutAppRoot.style.pointerEvents =
				'auto';
		}


		loadLocalNotes();

		renderItems();

		restoreAddress();

		renderFulfillmentLabel();

		setupScheduleSlots();

		loadScheduleForCurrentType();

		updateSummary();

		setupOrderNoteSheet();

		setupItemNoteSheet();

		updateAddressBlock();

		restoreCheckoutDraft();

		var customerNameInput = document.getElementById('x-customer-name');
		var customerPhoneInput = document.getElementById('x-customer-phone');

		[ customerNameInput, customerPhoneInput ].forEach(function (input) {
			if (!input) return;
			input.addEventListener('input', function () {
				updateAddressBlock();
				setSubmitAvailability();
				saveCheckoutDraft();
			});
		});

		setSubmitAvailability();


		var headerBack =
			document.querySelector(
				'.x-header a, .x-header [aria-label="Kembali"]'
			);

		if (headerBack) {
			headerBack.addEventListener(
				'click',
				function (event) {
					event.preventDefault();
					returnToHome();
				}
			);
		}


		var fulfillmentButton =
			document.getElementById(
				'x-fulfillment-change'
			);


		if (fulfillmentButton) {

			fulfillmentButton.addEventListener(
				'click',
				openFulfillmentSheet
			);
		}


		var addressChange =
			document.getElementById(
				'x-address-change'
			);


		if (addressChange) {

			addressChange.addEventListener(
				'click',
				openAddressPicker
			);
		}


		var submit =
			document.getElementById(
				'x-submit-order'
			);


		if (submit) {

			submit.addEventListener(
				'click',
				submitOrder
			);
		}


		var paymentButton =
			document.getElementById(
				'x-payment-compact'
			);


		if (paymentButton) {

			paymentButton.addEventListener(
				'click',
				openPaymentMethodSheet
			);
		}

		var paymentMoreButton =
			document.getElementById(
				'x-payment-compact-more'
			);

		if (paymentMoreButton) {

			paymentMoreButton.addEventListener(
				'click',
				openPaymentMethodSheet
			);
		}

		renderPaymentLabel();


		/*
		 * Back-button / gesture handling for every overlay this file opens
		 * (address picker, order-note sheet, and anything using
		 * createOverlay()) is now owned by the single shared XentraNav
		 * stack defined in homev.html - see class-xentra-checkout notes.
		 * No local popstate listener is needed here any more; having one
		 * used to run *in addition to* the shared one and fight over the
		 * same history entries, which is what broke Back/gesture nav.
		 */



	}


	window.XentraMountCheckout = function ( session ) {

		window.__XENTRA_CHECKOUT_STATE_ACTIVE = true;

		window.XentraCheckoutSession =
			session || {};

		SESSION =
			window.XentraCheckoutSession;

		SETTINGS =
			SESSION.settings || {};

		TOKEN =
			SESSION.token || '';

		xentraCheckoutMounted = false;

		init();

	};


	if (
		document.readyState ===
		'loading'
	) {

		document.addEventListener(
			'DOMContentLoaded',
			init
		);

	} else {

		init();
	}

	window.addEventListener('pageshow', function () {
		var raw = localStorage.getItem('xentra_mvp_v4_cart');
		if (raw) {
			try {
				var parsed = JSON.parse(raw);
				var cData = (parsed && parsed.data) ? parsed.data : parsed;
				if (cData && Array.isArray(cData.items) && cData.items.length === 0) {
					var homeUrl = (window.XentraConfig && window.XentraConfig.homeUrl) || '/';
					window.location.replace(homeUrl);
				}
			} catch (e) {}
		}
	});

})();