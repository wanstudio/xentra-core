<?php
header('Content-Type: application/manifest+json; charset=utf-8');
header('Cache-Control: public, max-age=86400');
header('Access-Control-Allow-Origin: *');

readfile(__DIR__ . '/manifest.json');