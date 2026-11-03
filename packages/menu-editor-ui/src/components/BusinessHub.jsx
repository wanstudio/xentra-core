import React, { useState } from 'react';
import CatalogSubHub from './CatalogSubHub';

export const businessSections = [
  {
    id: 'kitchen',
    title: 'Produk & Dapur',
    items: [
      {
        id: 'materials',
        title: 'Bahan Baku',
        description: 'Kelola bahan mentah yang dibeli dari supplier, menentukan satuan beli',
        color: 'bg-[#4285F4]',
        colorHex: '#4285F4',
        icon: '/owner/assets/icons/si_inventory-fill.svg',
        iconAlt: 'Ikon Bahan Baku',
        chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
        route: '#business/materials',
        iconSvg: (
          <svg width="23" height="23" viewBox="0 0 23 23" fill="none" aria-hidden="true">
            <path d="M0 4.40841C0 3.74758 0.262514 3.11382 0.729792 2.64654C1.19707 2.17926 1.83084 1.91675 2.49167 1.91675H20.5083C21.1692 1.91675 21.8029 2.17926 22.2702 2.64654C22.7375 3.11382 23 3.74758 23 4.40841V5.17508C23 5.83591 22.7375 6.46968 22.2702 6.93696C21.8029 7.40423 21.1692 7.66675 20.5083 7.66675H20.125V17.8251C20.125 19.0997 19.0996 20.1251 17.825 20.1251H5.175C3.90042 20.1251 2.875 19.0997 2.875 17.8251V7.66675H2.49167C1.83084 7.66675 1.19707 7.40423 0.729792 6.93696C0.262514 6.46968 0 5.83591 0 5.17508L0 4.40841ZM2.49167 3.83341C2.33917 3.83341 2.19291 3.894 2.08508 4.00183C1.97725 4.10966 1.91667 4.25592 1.91667 4.40841V5.17508C1.91667 5.32758 1.97725 5.47383 2.08508 5.58167C2.19291 5.6895 2.33917 5.75008 2.49167 5.75008H20.5083C20.6608 5.75008 20.8071 5.6895 20.9149 5.58167C21.0228 5.47383 21.0833 5.32758 21.0833 5.17508V4.40841C21.0833 4.25592 21.0228 4.10966 20.9149 4.00183C20.8071 3.894 20.6608 3.83341 20.5083 3.83341H2.49167ZM7.66667 9.58342C7.4125 9.58342 7.16875 9.68438 6.98902 9.8641C6.8093 10.0438 6.70833 10.2876 6.70833 10.5417C6.70833 10.7959 6.8093 11.0397 6.98902 11.2194C7.16875 11.3991 7.4125 11.5001 7.66667 11.5001H15.3333C15.5875 11.5001 15.8313 11.3991 16.011 11.2194C16.1907 11.0397 16.2917 10.7959 16.2917 10.5417C16.2917 10.2876 16.1907 10.0438 16.011 9.8641C15.8313 9.68438 15.5875 9.58342 15.3333 9.58342H7.66667Z" fill="white" fillRule="evenodd" clipRule="evenodd"/>
          </svg>
        ),
      },
      {
        id: 'products',
        title: 'Item Master + Resep',
        description: 'Produk yang dimasak di dapur, lengkap dengan racikan resep & hitung HPP otomatis per porsi',
        color: 'bg-[#34A853]',
        colorHex: '#34A853',
        icon: '/owner/assets/icons/mdi_food-drumstick.svg',
        iconAlt: 'Ikon Item Master dan Resep',
        chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
        route: '#catalog/products',
        iconSvg: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M20.1604 12.7302C20.8255 12.0661 21.3327 11.2609 21.6446 10.3743C21.9565 9.48776 22.0651 8.5424 21.9623 7.60818C21.8596 6.67397 21.5482 5.7748 21.0511 4.97718C20.5539 4.17956 19.8839 3.5039 19.0904 3.00017C17.0804 1.67017 14.3904 1.66017 12.3604 2.97017C10.6004 4.10017 9.63042 5.86017 9.46042 7.68017C9.33042 9.00017 8.83042 10.2302 7.91042 11.1502L7.88042 11.1802C6.72042 12.3402 6.72042 14.1102 7.81042 15.1902L8.80042 16.1802C9.32435 16.7037 10.0347 16.9979 10.7754 16.9979C11.5161 16.9979 12.2265 16.7037 12.7504 16.1802C13.7204 15.2102 15.0004 14.6802 16.3904 14.5302C17.7604 14.3802 19.1004 13.7802 20.1604 12.7302ZM6.26042 19.8602C6.53042 20.4202 6.44042 21.1002 5.97042 21.5602C5.76687 21.7668 5.50743 21.9095 5.22393 21.9708C4.94043 22.0321 4.64521 22.0094 4.37446 21.9053C4.10372 21.8013 3.86923 21.6205 3.69976 21.3851C3.53029 21.1497 3.43321 20.8699 3.42042 20.5802C3.13065 20.5674 2.85092 20.4703 2.61552 20.3008C2.38013 20.1314 2.19932 19.8969 2.09527 19.6261C1.99122 19.3554 1.96845 19.0602 2.02976 18.7767C2.09107 18.4932 2.2338 18.2337 2.44042 18.0302C2.90042 17.5702 3.59042 17.4702 4.14042 17.7402L6.62042 15.3102C6.76042 15.5002 6.92042 15.7202 7.10042 15.9002L8.09042 16.8902C8.30042 17.0902 8.50042 17.2602 8.76042 17.4102L6.26042 19.8602Z" fill="white"/>
          </svg>
        ),
      },
      {
        id: 'categories',
        title: 'Kategori & Menu',
        description: 'Master menu, kategori, item penyusun, dan pilihan item',
        color: 'bg-[#EA4335]',
        colorHex: '#EA4335',
        icon: '/owner/assets/icons/bxs_category.svg',
        iconAlt: 'Ikon Kategori dan Menu',
        chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
        route: '#catalog/categories',
        iconSvg: (
          <svg width="24" height="24" viewBox="0 0 25 25" fill="none" aria-hidden="true">
            <path d="M4.16667 11.4583H10.4167C10.6929 11.4583 10.9579 11.3486 11.1532 11.1532C11.3486 10.9579 11.4583 10.6929 11.4583 10.4167V4.16667C11.4583 3.8904 11.3486 3.62545 11.1532 3.4301C10.9579 3.23475 10.6929 3.125 10.4167 3.125H4.16667C3.8904 3.125 3.62545 3.23475 3.4301 3.4301C3.23475 3.62545 3.125 3.8904 3.125 4.16667V10.4167C3.125 10.6929 3.23475 10.9579 3.4301 11.1532C3.62545 11.3486 3.8904 11.4583 4.16667 11.4583ZM14.5833 11.4583H20.8333C21.1096 11.4583 21.3746 11.3486 21.5699 11.1532C21.7653 10.9579 21.875 10.6929 21.875 10.4167V4.16667C21.875 3.8904 21.7653 3.62545 21.5699 3.4301C21.3746 3.23475 21.1096 3.125 20.8333 3.125H14.5833C14.3071 3.125 14.0421 3.23475 13.8468 3.4301C13.6514 3.62545 13.5417 3.8904 13.5417 4.16667V10.4167C13.5417 10.6929 13.6514 10.9579 13.8468 11.1532C14.0421 11.3486 14.3071 11.4583 14.5833 11.4583ZM4.16667 21.875H10.4167C10.6929 21.875 10.9579 21.7653 11.1532 21.5699C11.3486 21.3746 11.4583 21.1096 11.4583 20.8333V14.5833C11.4583 14.3071 11.3486 14.0421 11.1532 13.8468C10.9579 13.6514 10.6929 13.5417 10.4167 13.5417H4.16667C3.8904 13.5417 3.62545 13.6514 3.4301 13.8468C3.23475 14.0421 3.125 14.3071 3.125 14.5833V20.8333C3.125 21.1096 3.23475 21.3746 3.4301 21.5699C3.62545 21.7653 3.8904 21.875 4.16667 21.875ZM17.7083 21.875C20.0063 21.875 21.875 20.0063 21.875 17.7083C21.875 15.4104 20.0063 13.5417 17.7083 13.5417C15.4104 13.5417 13.5417 15.4104 13.5417 17.7083C13.5417 20.0063 15.4104 21.875 17.7083 21.875Z" fill="white"/>
          </svg>
        ),
      },
    ],
  },
  {
    id: 'operations',
    title: 'Outlet & Karyawan',
    items: [
      {
        id: 'branches',
        title: 'Cabang Restoran',
        description: 'Konfigurasi outlet, alamat lokasi cabang, jam operasional, dan penetapan menu cabang',
        color: 'bg-[#FBBC05]',
        colorHex: '#FBBC05',
        icon: '/owner/assets/icons/dashicons_store.svg',
        iconAlt: 'Ikon Cabang Restoran',
        chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
        route: '#branches',
        iconSvg: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M1.2 12C1.692 12.348 2.352 12.516 3 12.516C3.66 12.516 4.308 12.348 4.8 12C5.544 11.448 6 10.596 6 9.6C6 10.596 6.444 11.448 7.2 12C7.692 12.348 8.352 12.516 9 12.516C9.66 12.516 10.308 12.348 10.8 12C11.544 11.448 12 10.596 12 9.6C12 10.596 12.444 11.448 13.2 12C13.692 12.348 14.352 12.516 15.012 12.516C15.66 12.516 16.308 12.348 16.8 12C17.544 11.448 18 10.596 18 9.6C18 10.596 18.444 11.448 19.2 12C19.692 12.348 20.352 12.516 21 12.516C21.66 12.516 22.308 12.348 22.8 12C23.556 11.448 24 10.596 24 9.6V8.4L20.4 0H4.8L0 8.4V9.6C0 10.596 0.444 11.448 1.2 12ZM3.6 22.788H9.6V16.788H14.4V22.788H20.4V14.388C19.956 14.328 19.536 14.124 19.2 13.872C18.444 13.332 18 12.996 18 12C18 12.996 17.544 13.332 16.8 13.872C16.308 14.232 15.66 14.388 15.012 14.4C14.352 14.4 13.692 14.232 13.2 13.872C12.444 13.332 12 12.996 12 12C12 12.996 11.544 13.332 10.8 13.872C10.308 14.232 9.66 14.388 9 14.4C8.352 14.4 7.692 14.232 7.2 13.872C6.444 13.332 6 12.996 6 11.988C6 12.996 5.544 13.332 4.8 13.872C4.452 14.124 4.044 14.328 3.6 14.4V22.788Z" fill="white"/>
          </svg>
        ),
      },
      {
        id: 'team',
        title: 'Tim & Akses',
        description: 'Daftar karyawan, PIN kasir POS, hak akses manajer/kitchen, dan penugasan cabang',
        color: 'bg-[#455A64]',
        colorHex: '#455A64',
        icon: '/owner/assets/icons/fluent_people-team-add-20-filled.svg',
        iconAlt: 'Ikon Tim dan Akses',
        chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
        route: '#team',
        iconSvg: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M15.0004 5.3999C15.0004 6.19555 14.6843 6.95861 14.1217 7.52122C13.5591 8.08383 12.796 8.3999 12.0004 8.3999C11.2047 8.3999 10.4417 8.08383 9.87907 7.52122C9.31646 6.95861 9.00039 6.19555 9.00039 5.3999C9.00039 4.60425 9.31646 3.84119 9.87907 3.27858C10.4417 2.71597 11.2047 2.3999 12.0004 2.3999C12.796 2.3999 13.5591 2.71597 14.1217 3.27858C14.6843 3.84119 15.0004 4.60425 15.0004 5.3999ZM21.0004 5.9999C21.0004 6.63642 20.7475 7.24687 20.2974 7.69696C19.8474 8.14705 19.2369 8.3999 18.6004 8.3999C17.9639 8.3999 17.3534 8.14705 16.9033 7.69696C16.4532 7.24687 16.2004 6.63642 16.2004 5.9999C16.2004 5.36338 16.4532 4.75293 16.9033 4.30285C17.3534 3.85276 17.9639 3.5999 18.6004 3.5999C19.2369 3.5999 19.8474 3.85276 20.2974 4.30285C20.7475 4.75293 21.0004 5.36338 21.0004 5.9999ZM5.40039 8.3999C6.03691 8.3999 6.64736 8.14705 7.09745 7.69696C7.54753 7.24687 7.80039 6.63642 7.80039 5.9999C7.80039 5.36338 7.54753 4.75293 7.09745 4.30285C6.64736 3.85276 6.03691 3.5999 5.40039 3.5999C4.76387 3.5999 4.15342 3.85276 3.70333 4.30285C3.25325 4.75293 3.00039 5.36338 3.00039 5.9999C3.00039 6.63642 3.25325 7.24687 3.70333 7.69696C4.15342 8.14705 4.76387 8.3999 5.40039 8.3999ZM7.20039 11.0999C7.20039 10.2719 7.87239 9.5999 8.70039 9.5999H15.3004C15.6513 9.59973 15.9912 9.7226 16.2608 9.94711C16.5305 10.1716 16.7129 10.4836 16.7764 10.8287C15.584 10.9417 14.4449 11.377 13.481 12.088C12.5172 12.799 11.765 13.7588 11.305 14.8647C10.8451 15.9705 10.6947 17.1807 10.8701 18.3655C11.0454 19.5503 11.5398 20.6651 12.3004 21.5903C11.6461 21.6313 10.9903 21.5378 10.3735 21.3156C9.75672 21.0934 9.19199 20.7472 8.71413 20.2983C8.23628 19.8495 7.85544 19.3075 7.59509 18.7058C7.33475 18.1041 7.20042 17.4555 7.20039 16.7999V11.0999ZM17.9872 10.8251C19.354 10.9451 20.6008 11.4827 21.6004 12.3083V11.0999C21.6004 10.2719 20.9284 9.5999 20.1004 9.5999H17.5456C17.7856 9.9575 17.9416 10.3751 17.986 10.8251M6.00039 11.0999C6.00039 10.5443 6.16839 10.0295 6.45519 9.5999H3.90039C3.07239 9.5999 2.40039 10.2719 2.40039 11.0999V15.5999C2.40033 16.1136 2.51024 16.6215 2.72271 17.0892C2.93519 17.5569 3.24532 17.9738 3.63226 18.3117C4.0192 18.6497 4.47399 18.9009 4.96607 19.0485C5.45815 19.1961 5.97613 19.2367 6.48519 19.1675C6.16468 18.4194 5.99973 17.6138 6.00039 16.7999V11.0999ZM22.8004 17.3999C22.8004 18.8321 22.2315 20.2056 21.2188 21.2183C20.2061 22.231 18.8326 22.7999 17.4004 22.7999C15.9682 22.7999 14.5947 22.231 13.582 21.2183C12.5693 20.2056 12.0004 18.8321 12.0004 17.3999C12.0004 15.9677 12.5693 14.5942 13.582 13.5815C14.5947 12.5688 15.9682 11.9999 17.4004 11.9999C18.8326 11.9999 20.2061 12.5688 21.2188 13.5815C22.2315 14.5942 22.8004 15.9677 22.8004 17.3999ZM18.0004 14.9999C18.0004 14.8408 17.9372 14.6882 17.8247 14.5756C17.7121 14.4631 17.5595 14.3999 17.4004 14.3999C17.2413 14.3999 17.0886 14.4631 16.9761 14.5756C16.8636 14.6882 16.8004 14.8408 16.8004 14.9999V16.7999H15.0004C14.8413 16.7999 14.6886 16.8631 14.5761 16.9756C14.4636 17.0882 14.4004 17.2408 14.4004 17.3999C14.4004 17.559 14.4636 17.7116 14.5761 17.8242C14.6886 17.9367 14.8413 17.9999 15.0004 17.9999H16.8004V19.7999C16.8004 19.959 16.8636 20.1116 16.9761 20.2242C17.0886 20.3367 17.2413 20.3999 17.4004 20.3999C17.5595 20.3999 17.7121 20.3367 17.8247 20.2242C17.9372 20.1116 18.0004 19.959 18.0004 19.7999V17.9999H19.8004C19.9595 17.9999 20.1121 17.9367 20.2247 17.8242C20.3372 17.7116 20.4004 17.559 20.4004 17.3999C20.4004 17.2408 20.3372 17.0882 20.2247 16.9756C20.1121 16.8631 19.9595 16.7999 19.8004 16.7999H18.0004V14.9999Z" fill="white"/>
          </svg>
        ),
      },
    ],
  },
  {
    id: 'commercial',
    title: 'Pemasaran & Brand',
    items: [
      {
        id: 'affiliate',
        title: 'Program Kemitraan (Affiliate)',
        description: 'Kelola komisi affiliate, persetujuan mitra, review penarikan saldo, dan menu story',
        color: 'bg-[#10B981]',
        colorHex: '#10B981',
        icon: '/owner/assets/icons/basil_bullhorn-solid.svg',
        iconAlt: 'Ikon Program Kemitraan Affiliate',
        chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
        route: 'business/affiliate',
        badge: 'Aktif',
        iconSvg: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" fill="white"/>
          </svg>
        ),
      },
      {
        id: 'marketing',
        title: 'Promosi & Banner',
        description: 'Program diskon, promo menu bundling, dan spanduk promosi aplikasi pelanggan',
        color: 'bg-[#EA4335]',
        colorHex: '#EA4335',
        icon: '/owner/assets/icons/basil_bullhorn-solid.svg',
        iconAlt: 'Ikon Promosi dan Banner',
        chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
        route: '#marketing/promotions',
        iconSvg: (
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden="true">
            <path d="M23.4615 14.1936C21.5697 9.9569 19.2443 5.92923 16.5212 2.17248C15.6702 0.997558 13.8626 1.19682 13.2868 2.52873L11.0895 7.61268C10.397 9.21605 9.20624 10.5536 7.69381 11.427L4.1024 13.5005C3.85358 13.6442 3.67201 13.8808 3.59765 14.1583C3.52328 14.4359 3.56221 14.7316 3.70587 14.9804L5.96246 18.8889C6.10612 19.1377 6.34274 19.3193 6.62026 19.3937C6.89779 19.468 7.19349 19.4291 7.44232 19.2854L11.0356 17.2109C12.5478 16.338 14.3009 15.9754 16.0353 16.1769L21.5368 16.8159C22.9787 16.9842 24.0541 15.5189 23.4615 14.1936Z" fill="white"/>
            <path d="M12.7846 18.9761C12.7512 18.8567 12.6909 18.7466 12.6084 18.6542C12.526 18.5617 12.4234 18.4894 12.3087 18.4426C12.1939 18.3959 12.07 18.376 11.9464 18.3845C11.8228 18.393 11.7028 18.4297 11.5955 18.4917L9.71913 19.575C9.58865 19.6506 9.48177 19.761 9.41045 19.8938C9.33914 20.0267 9.3062 20.1768 9.31533 20.3273L9.46047 22.7453C9.47247 22.9446 9.55739 23.1324 9.69903 23.2731C9.84067 23.4137 10.0291 23.4973 10.2284 23.5079L12.9802 23.6504C13.109 23.6571 13.2376 23.6331 13.3553 23.5803C13.4729 23.5275 13.5764 23.4475 13.657 23.3468C13.7376 23.2461 13.7931 23.1277 13.8188 23.0013C13.8446 22.8749 13.8399 22.7442 13.8051 22.62L12.7846 18.9761Z" fill="white"/>
          </svg>
        ),
      },
      {
        id: 'customers',
        title: 'Pelanggan (CRM)',
        description: 'Kelola data pelanggan, riwayat pembelian, poin, dan loyalty',
        color: 'bg-[#7B3DEC]',
        colorHex: '#7B3DEC',
        icon: '/owner/assets/icons/flowbite_user-solid.svg',
        iconAlt: 'Ikon Pelanggan',
        chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
        route: '#customers',
        iconSvg: (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z" fill="white"/>
            <path d="M12 14.5C6.99 14.5 2.5 17.08 2.5 20.25V22H21.5V20.25C21.5 17.08 17.01 14.5 12 14.5Z" fill="white"/>
          </svg>
        ),
      },
      {
        id: 'brand',
        title: 'Brand & Kanal Digital',
        description: 'Identitas brand resto, logo, tampilan storefront, dan konfigurasi kanal penjualan',
        color: 'bg-[#007189]',
        colorHex: '#007189',
        icon: '/owner/assets/icons/bi_palette-fill.svg',
        iconAlt: 'Ikon Brand dan Kanal Digital',
        chevron: '/owner/assets/icons/akar-icons_chevron-right-small.svg',
        route: '#brand',
        iconSvg: (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M18.6495 15.105C21.1995 15.8775 24 16.725 24 12C24 9.62663 23.2962 7.30655 21.9776 5.33316C20.6591 3.35977 18.7849 1.8217 16.5922 0.913451C14.3995 0.00519937 11.9867 -0.232441 9.65892 0.230582C7.33115 0.693605 5.19295 1.83649 3.51472 3.51472C1.83649 5.19295 0.693605 7.33115 0.230582 9.65892C-0.232441 11.9867 0.00519937 14.3995 0.913451 16.5922C1.8217 18.7849 3.35977 20.6591 5.33316 21.9776C7.30655 23.2962 9.62663 24 12 24C14.994 24 14.739 21.744 14.4735 19.38C14.2875 17.7285 14.0955 16.0245 15 15C15.6975 14.2095 17.13 14.6445 18.6495 15.105ZM12 7.50001C11.7045 7.50001 11.412 7.44181 11.139 7.32873C10.866 7.21566 10.6179 7.04993 10.409 6.841C10.2001 6.63206 10.0343 6.38403 9.92128 6.11104C9.8082 5.83806 9.75001 5.54548 9.75001 5.25001C9.75001 4.95453 9.8082 4.66195 9.92128 4.38897C10.0343 4.11598 10.2001 3.86795 10.409 3.65902C10.6179 3.45008 10.866 3.28435 11.139 3.17128C11.412 3.0582 11.7045 3.00001 12 3.00001C12.5967 3.00001 13.169 3.23706 13.591 3.65902C14.013 4.08097 14.25 4.65327 14.25 5.25001C14.25 5.84674 14.013 6.41904 13.591 6.841C13.169 7.26295 12.5967 7.50001 12 7.50001ZM18.75 12C18.1533 12 17.581 11.763 17.159 11.341C16.7371 10.919 16.5 10.3467 16.5 9.75001C16.5 9.15327 16.7371 8.58097 17.159 8.15902C17.581 7.73706 18.1533 7.50001 18.75 7.50001C19.3467 7.50001 19.919 7.73706 20.341 8.15902C20.763 8.58097 21 9.15327 21 9.75001C21 10.3467 20.763 10.919 20.341 11.341C19.919 11.763 19.3467 12 18.75 12ZM7.50001 9.75001C7.50001 10.0455 7.44181 10.3381 7.32873 10.611C7.21566 10.884 7.04993 11.1321 6.841 11.341C6.63206 11.5499 6.38403 11.7157 6.11104 11.8287C5.83806 11.9418 5.54548 12 5.25001 12C4.95453 12 4.66195 11.9418 4.38897 11.8287C4.11598 11.7157 3.86795 11.5499 3.65902 11.341C3.45008 11.1321 3.28435 10.884 3.17128 10.611C3.0582 10.3381 3.00001 10.0455 3.00001 9.75001C3.00001 9.15327 3.23706 8.58097 3.65902 8.15902C4.08097 7.73706 4.65327 7.50001 5.25001 7.50001C5.84674 7.50001 6.41904 7.73706 6.841 8.15902C7.26295 8.58097 7.50001 9.15327 7.50001 9.75001ZM8.25001 19.5C7.65327 19.5 7.08097 19.263 6.65902 18.841C6.23706 18.419 6.00001 17.8467 6.00001 17.25C6.00001 16.6533 6.23706 16.081 6.65902 15.659C7.08097 15.2371 7.65327 15 8.25001 15C8.84674 15 9.41904 15.2371 9.841 15.659C10.263 16.081 10.5 16.6533 10.5 17.25C10.5 17.8467 10.263 18.419 9.841 18.841C9.41904 19.263 8.84674 19.5 8.25001 19.5Z" fill="white"/>
          </svg>
        ),
      },
    ],
  },
];

export const businessItems = businessSections.flatMap((sec) => sec.items);

export default function BusinessHub({ initialSubHub = null, onNavigate }) {
  const [activeSubHub, setActiveSubHub] = useState(initialSubHub);
  const [prevInitialSubHub, setPrevInitialSubHub] = useState(initialSubHub);
  if (initialSubHub !== prevInitialSubHub) {
    setPrevInitialSubHub(initialSubHub);
    setActiveSubHub(initialSubHub);
  }
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBusiness, setSelectedBusiness] = useState(null);

  if (activeSubHub === 'catalog') {
    return (
      <CatalogSubHub
        onBack={() => {
          setActiveSubHub(null);
          if (typeof window.closeBusinessSubHub === 'function') {
            window.closeBusinessSubHub();
          } else if (typeof window.navigateTo === 'function') {
            window.navigateTo('business');
          }
        }}
        onNavigate={(route) => {
          if (typeof onNavigate === 'function') {
            onNavigate(route);
          } else if (typeof window.navigateTo === 'function') {
            window.navigateTo(String(route || '').replace(/^#\/?/, ''));
          }
        }}
      />
    );
  }

  // Filter sections by search term across section titles and item details
  const filteredSections = businessSections
    .map((sec) => {
      const searchValue = searchTerm.trim().toLowerCase();
      if (!searchValue) return sec;
      const matchedItems = sec.items.filter((item) =>
        `${item.title} ${item.description} ${sec.title}`
          .toLowerCase()
          .includes(searchValue)
      );
      return { ...sec, items: matchedItems };
    })
    .filter((sec) => sec.items.length > 0);

  const handleCardClick = (item) => {
    setSelectedBusiness(item.title);
    if (typeof onNavigate === 'function') {
      onNavigate(item.route, item.id);
      return;
    }
    const cleanRoute = String(item.route || '').replace(/^#\/?/, '');
    if (typeof window.navigateTo === 'function') {
      window.navigateTo(cleanRoute);
      return;
    }
    if (typeof window !== 'undefined' && window.history && typeof window.history.pushState === 'function') {
      window.history.pushState({ xentraRoute: cleanRoute }, '', '#' + cleanRoute);
    }
  };

  return (
    <div
      id="modern-business-hub-root"
      style={{
        width: '100%',
        maxWidth: '390px',
        margin: '0 auto',
        paddingBottom: '0px',
        boxSizing: 'border-box',
        backgroundColor: '#F9FAFC',
        fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif",
        display: 'flex',
        flexDirection: 'column',
      }}
      className="w-full flex flex-col pb-0 max-w-lg md:mx-auto font-sans select-none"
    >
      {/* 1. Search Bar (Figma: height 48px, radius 14px, outline 1px #CBD5E1 solid) */}
      {/* User requirement: 24px space between search bar and title 'Produk & Dapur' */}
      <form
        style={{
          width: '100%',
          height: '48px',
          backgroundColor: '#FFFFFF',
          borderRadius: '14px',
          outline: '1px #CBD5E1 solid',
          outlineOffset: '-1px',
          boxSizing: 'border-box',
          marginBottom: '24px',
        }}
        className="w-full h-12 flex items-center px-4 gap-[15px] rounded-[14px] overflow-hidden bg-white outline outline-1 -outline-offset-1 outline-[#CBD5E1] focus-within:outline-[#0F172A] focus-within:outline-2 transition-all mb-6"
        onSubmit={(event) => event.preventDefault()}
      >
        <div
          style={{ width: '17px', height: '17px', position: 'relative', overflow: 'hidden' }}
          className="w-[17px] h-[17px] relative flex items-center justify-center shrink-0"
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#94A3B8"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <input
          type="search"
          aria-label="Cari menu atau pengaturan bisnis"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          onSearch={(event) => setSearchTerm(event.target.value)}
          placeholder="Cari menu atau pengaturan bisnis"
          style={{
            fontFamily: "'Plus Jakarta Sans', sans-serif",
            fontSize: '13px',
            fontWeight: 500,
            color: '#0F172A',
          }}
          className="w-full bg-transparent border-none outline-none font-medium text-slate-800 text-[13px] tracking-[0] leading-[normal] placeholder:text-[#94A3B8]"
        />
        {searchTerm.length > 0 && (
          <button
            type="button"
            aria-label="Bersihkan pencarian"
            onClick={() => setSearchTerm('')}
            className="w-6 h-6 rounded-full bg-slate-100 hover:bg-slate-200 active:scale-95 flex items-center justify-center text-slate-500 border-none cursor-pointer shrink-0 p-0 transition-all"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="10.5" y1="3.5" x2="3.5" y2="10.5" />
              <line x1="3.5" y1="3.5" x2="10.5" y2="10.5" />
            </svg>
          </button>
        )}
      </form>

      {/* 2. Sections Container */}
      {/* 24px between search bar & Produk & Dapur, 24px between Kategori & Menu & Outlet & Karyawan, 24px between Tim & Akses & Pemasaran & Brand */}
      {filteredSections.length === 0 ? (
        <div
          style={{
            width: '100%',
            padding: '32px 16px',
            textAlign: 'center',
            fontSize: '13px',
            color: '#94A3B8',
            backgroundColor: '#FFFFFF',
            borderRadius: '14px',
            outline: '1px #CBD5E1 solid',
            outlineOffset: '-1px',
          }}
          className="w-full py-10 text-center text-sm text-slate-400 bg-white rounded-[14px] outline outline-1 -outline-offset-1 outline-[#CBD5E1]"
        >
          Tidak ada menu atau modul bisnis yang sesuai dengan pencarian "{searchTerm}"
        </div>
      ) : (
        filteredSections.map((sec, index) => {
          const isLastSection = index === filteredSections.length - 1;
          return (
            <div
              key={sec.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                alignItems: 'flex-start',
                marginBottom: isLastSection ? '0px' : '24px',
              }}
              className={`flex flex-col w-full items-start ${isLastSection ? 'mb-0' : 'mb-6'}`}
            >
              {/* Section Title: 18px Bold #0F172A */}
              <h2
                style={{
                  color: '#0F172A',
                  fontSize: '18px',
                  fontFamily: "'Plus Jakarta Sans', sans-serif",
                  fontWeight: 700,
                  lineHeight: '18px',
                  margin: 0,
                  marginBottom: '16px',
                }}
                className="flex items-center font-bold text-[#0F172A] text-[18px] tracking-[0] leading-[18px] m-0 mb-4"
              >
                {sec.title}
              </h2>

              {/* Section Cards List (16px gap between cards) */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  width: '100%',
                  alignItems: 'flex-start',
                  gap: '16px',
                }}
                className="flex flex-col w-full items-start gap-4"
              >
              {sec.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-label={`Buka ${item.title}`}
                  aria-pressed={selectedBusiness === item.title}
                  onClick={() => handleCardClick(item)}
                  style={{
                    width: '100%',
                    padding: '16px',
                    borderRadius: '14px',
                    outline: '1px #CBD5E1 solid',
                    outlineOffset: '-1px',
                    backgroundColor: '#FFFFFF',
                    border: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                    boxSizing: 'border-box',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                  className="flex w-full items-center gap-4 p-4 relative rounded-[14px] bg-white outline outline-1 -outline-offset-1 outline-[#CBD5E1] hover:outline-slate-400 active:scale-[0.99] transition-all cursor-pointer text-left"
                >
                  {/* Icon Box: 45x45 borderRadius: 10 */}
                  <span
                    style={{
                      width: '45px',
                      height: '45px',
                      borderRadius: '10px',
                      backgroundColor: item.colorHex,
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                    className={`relative w-[45px] h-[45px] ${item.color} rounded-[10px] aspect-[1] shrink-0 flex items-center justify-center`}
                  >
                    {item.iconSvg || (
                      <img
                        className="w-[24px] h-[24px] object-contain filter brightness-0 invert"
                        alt={item.iconAlt}
                        src={item.icon}
                      />
                    )}
                  </span>

                  {/* Text: Title 16px bold #0F172A, Description 13px font-medium #94A3B8 */}
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: '4px',
                    }}
                    className="flex flex-col flex-1 min-w-0 items-start gap-1 relative"
                  >
                    <span
                      style={{
                        color: '#0F172A',
                        fontSize: '16px',
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        fontWeight: 700,
                        lineHeight: '1.25',
                        wordBreak: 'break-word',
                      }}
                      className="relative w-fit mt-[-1.00px] font-bold text-[#0F172A] text-[16px] tracking-[0] leading-snug"
                    >
                      {item.title}
                    </span>
                    <span
                      style={{
                        color: '#94A3B8',
                        fontSize: '13px',
                        fontFamily: "'Plus Jakarta Sans', sans-serif",
                        fontWeight: 500,
                        lineHeight: '1.35',
                        wordBreak: 'break-word',
                      }}
                      className="relative self-stretch font-medium text-[#94A3B8] text-[13px] tracking-[0] leading-snug"
                    >
                      {item.description}
                    </span>
                  </span>

                  {/* Chevron Right: 13x13 */}
                  <span
                    style={{
                      width: '13px',
                      height: '13px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      color: '#303030',
                    }}
                    className="relative w-[13px] h-[13px] mr-[-2px] aspect-[1] shrink-0"
                    aria-hidden="true"
                  >
                    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                      <path
                        d="M4.5 2.5L8.5 6.5L4.5 10.5"
                        stroke="#303030"
                        strokeWidth="1.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })
      )}
    </div>
  );
}
